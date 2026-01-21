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
}
