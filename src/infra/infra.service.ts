import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalWorkspace } from '@pulumi/pulumi/automation';
import * as aws from '@pulumi/aws';

@Injectable()
export class InfraService {
  private readonly logger = new Logger(InfraService.name);

  constructor(private configService: ConfigService) {}

  async createVpcEc2(
    keyName: string,
    name: string = 'host-platform',
    instanceType: string = 't3.micro',
  ) {
    const awsRegion = this.configService.get('AWS_REGION') || 'us-east-1';
    const availabilityZone = `${awsRegion}a`;

    const pulumiProgram = async () => {
      // 1. VPC (red privada)
      const vpc = new aws.ec2.Vpc('main-vpc', {
        cidrBlock: '10.0.0.0/16',
        enableDnsHostnames: true,
        enableDnsSupport: true,
        tags: { Name: `${name}-vpc`, ManagedBy: 'NestJS-Orchestrator' },
      });

      // 2. Internet Gateway (salida a internet)
      const igw = new aws.ec2.InternetGateway('main-igw', {
        vpcId: vpc.id,
      });

      // 3. Subred pública
      const subnet = new aws.ec2.Subnet('public-subnet', {
        vpcId: vpc.id,
        cidrBlock: '10.0.1.0/24',
        mapPublicIpOnLaunch: true,
        availabilityZone,
        tags: { Name: `${name}-public-subnet` },
      });

      // 4. Tabla de rutas
      const routeTable = new aws.ec2.RouteTable('route-table', {
        vpcId: vpc.id,
        routes: [{ cidrBlock: '0.0.0.0/0', gatewayId: igw.id }],
        tags: { Name: `${name}-route-table` },
      });

      new aws.ec2.RouteTableAssociation('rta', {
        subnetId: subnet.id,
        routeTableId: routeTable.id,
      });

      // 5. Security Group (firewall)
      const secGroup = new aws.ec2.SecurityGroup('web-secgroup', {
        vpcId: vpc.id,
        description: 'Allow SSH and Web traffic',
        ingress: [
          { protocol: 'tcp', fromPort: 22, toPort: 22, cidrBlocks: ['0.0.0.0/0'] }, // SSH
          { protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'] }, // HTTP
          { protocol: 'tcp', fromPort: 443, toPort: 443, cidrBlocks: ['0.0.0.0/0'] }, // HTTPS
        ],
        egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
        tags: { Name: `${name}-web-secgroup` },
      });

      // 6. AMI: última Amazon Linux 2023 en la región
      const amiResult = await aws.ec2.getAmi({
        mostRecent: true,
        owners: ['amazon'],
        filters: [{ name: 'name', values: ['al2023-ami-*-x86_64'] }],
      });

      // 7. Instancia EC2
      const server = new aws.ec2.Instance('master-server', {
        instanceType,
        ami: amiResult.id,
        vpcSecurityGroupIds: [secGroup.id],
        subnetId: subnet.id,
        keyName,
        userData: `#!/bin/bash
dnf update -y
dnf install -y docker
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user
`,
        tags: { Name: `${name}-master-server`, ManagedBy: 'NestJS-Orchestrator' },
      });

      return {
        publicIp: server.publicIp,
        publicDns: server.publicDns,
        vpcId: vpc.id,
      };
    };

    try {
      const stack = await LocalWorkspace.createOrSelectStack({
        stackName: 'dev',
        projectName: 'vpc-ec2',
        program: pulumiProgram,
      });

      await stack.setConfig('aws:region', { value: awsRegion });

      this.logger.log(`Creando VPC y EC2 (${name}) en ${awsRegion}...`);
      const upRes = await stack.up({ onOutput: (msg) => this.logger.debug(msg) });

      const outputs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(upRes.outputs)) {
        outputs[k] = (v as { value?: unknown })?.value ?? v;
      }

      return outputs;
    } catch (e) {
      this.logger.error(`Error en VPC/EC2: ${(e as Error).message}`, (e as Error).stack);
      throw e;
    }
  }

  async createLoadBalancer(
    name: string,
    httpPort: number = 80,
    httpsPort?: number,
    targetPort: number = 3000,
    loadBalancerType: string = 'application',
  ) {
    const awsRegion = this.configService.get('AWS_REGION') || 'us-east-1';
    const availabilityZone = `${awsRegion}a`;

    const pulumiProgram = async () => {
      // 1. Obtener VPC existente por nombre
      const vpcResult = await aws.ec2.getVpc({
        filters: [
          { name: 'tag:Name', values: [`${name}-vpc`] },
          { name: 'tag:ManagedBy', values: ['NestJS-Orchestrator'] },
        ],
      });

      // 2. Obtener subredes públicas existentes
      const subnetsResult = await aws.ec2.getSubnets({
        filters: [
          { name: 'vpc-id', values: [vpcResult.id] },
          { name: 'tag:Name', values: [`${name}-public-subnet*`] },
        ],
      });

      if (subnetsResult.ids.length === 0) {
        throw new Error(`No se encontraron subredes públicas para ${name}`);
      }

      // 3. Obtener instancia EC2 existente
      // Usamos getInstances que devuelve una lista de IDs
      const instancesResult = await aws.ec2.getInstances({
        filters: [
          { name: 'vpc-id', values: [vpcResult.id] },
          { name: 'tag:Name', values: [`${name}-master-server`] },
          { name: 'instance-state-name', values: ['running'] },
        ],
      });

      if (!instancesResult.ids || instancesResult.ids.length === 0) {
        throw new Error(`No se encontró una instancia EC2 en ejecución para ${name}`);
      }

      // Usar la primera instancia encontrada
      const instanceId = instancesResult.ids[0];

      // 4. Security Group para el Load Balancer
      const albSecGroup = new aws.ec2.SecurityGroup('alb-secgroup', {
        vpcId: vpcResult.id,
        description: 'Security group for Application Load Balancer',
        ingress: [
          { protocol: 'tcp', fromPort: httpPort, toPort: httpPort, cidrBlocks: ['0.0.0.0/0'] },
          ...(httpsPort
            ? [{ protocol: 'tcp', fromPort: httpsPort, toPort: httpsPort, cidrBlocks: ['0.0.0.0/0'] }]
            : []),
        ],
        egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
        tags: { Name: `${name}-alb-secgroup`, ManagedBy: 'NestJS-Orchestrator' },
      });

      // 5. Actualizar Security Group de EC2 para permitir tráfico desde el ALB
      const ec2SecGroupResult = await aws.ec2.getSecurityGroups({
        filters: [
          { name: 'vpc-id', values: [vpcResult.id] },
          { name: 'tag:Name', values: [`${name}-web-secgroup`] },
        ],
      });

      if (ec2SecGroupResult.ids.length > 0) {
        const ec2SecGroupId = ec2SecGroupResult.ids[0];
        new aws.ec2.SecurityGroupRule('alb-to-ec2', {
          type: 'ingress',
          fromPort: targetPort,
          toPort: targetPort,
          protocol: 'tcp',
          sourceSecurityGroupId: albSecGroup.id,
          securityGroupId: ec2SecGroupId,
          description: 'Allow traffic from ALB to EC2',
        });
      }

      // 6. Target Group
      const targetGroup = new aws.lb.TargetGroup('app-target-group', {
        name: `${name}-tg`,
        port: targetPort,
        protocol: 'HTTP',
        vpcId: vpcResult.id,
        targetType: 'instance',
        healthCheck: {
          enabled: true,
          healthyThreshold: 2,
          unhealthyThreshold: 3,
          timeout: 5,
          interval: 30,
          path: '/',
          protocol: 'HTTP',
          matcher: '200',
        },
        tags: { Name: `${name}-target-group`, ManagedBy: 'NestJS-Orchestrator' },
      });

      // 7. Registrar instancia EC2 en el Target Group
      new aws.lb.TargetGroupAttachment('ec2-attachment', {
        targetGroupArn: targetGroup.arn,
        targetId: instanceId,
        port: targetPort,
      });

      // 8. Application Load Balancer
      const loadBalancer = new aws.lb.LoadBalancer('app-lb', {
        name: `${name}-alb`,
        loadBalancerType: loadBalancerType as 'application' | 'network',
        subnets: subnetsResult.ids,
        securityGroups: [albSecGroup.id],
        enableDeletionProtection: false,
        tags: { Name: `${name}-alb`, ManagedBy: 'NestJS-Orchestrator' },
      });

      // 9. Listener HTTP
      const httpListener = new aws.lb.Listener('http-listener', {
        loadBalancerArn: loadBalancer.arn,
        port: httpPort,
        protocol: 'HTTP',
        defaultActions: [
          {
            type: 'forward',
            targetGroupArn: targetGroup.arn,
          },
        ],
      });

      // 10. Listener HTTPS (opcional)
      let httpsListener;
      if (httpsPort) {
        httpsListener = new aws.lb.Listener('https-listener', {
          loadBalancerArn: loadBalancer.arn,
          port: httpsPort,
          protocol: 'HTTPS',
          sslPolicy: 'ELBSecurityPolicy-TLS-1-2-2017-01',
          // Nota: Para HTTPS necesitarías un certificado ACM
          // certificateArn: certificateArn,
          defaultActions: [
            {
              type: 'forward',
              targetGroupArn: targetGroup.arn,
            },
          ],
        });
      }

      return {
        loadBalancerArn: loadBalancer.arn,
        loadBalancerDns: loadBalancer.dnsName,
        targetGroupArn: targetGroup.arn,
        httpListenerArn: httpListener.arn,
        httpsListenerArn: httpsListener?.arn,
        vpcId: vpcResult.id,
        instanceId,
      };
    };

    try {
      const stack = await LocalWorkspace.createOrSelectStack({
        stackName: 'dev',
        projectName: 'load-balancer',
        program: pulumiProgram,
      });

      await stack.setConfig('aws:region', { value: awsRegion });

      this.logger.log(`Creando Load Balancer para ${name} en ${awsRegion}...`);
      const upRes = await stack.up({ onOutput: (msg) => this.logger.debug(msg) });

      const outputs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(upRes.outputs)) {
        outputs[k] = (v as { value?: unknown })?.value ?? v;
      }

      return outputs;
    } catch (e) {
      this.logger.error(`Error creando Load Balancer: ${(e as Error).message}`, (e as Error).stack);
      throw e;
    }
  }
}
