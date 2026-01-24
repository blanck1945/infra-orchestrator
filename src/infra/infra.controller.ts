import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InfraService } from './infra.service';
import { CreateVpcEc2Dto } from './dto/create-vpc-ec2.dto';
import { CreateLoadBalancerDto } from './dto/create-load-balancer.dto';

@ApiTags('Infra (VPC + EC2)')
@Controller('infra')
export class InfraController {
  constructor(private readonly infraService: InfraService) {}

  @Post('vpc-ec2')
  @ApiOperation({ summary: 'Crea VPC, subred pública, security group y EC2 con Docker' })
  @ApiResponse({ status: 201, description: 'VPC y EC2 creados. Retorna publicIp y publicDns.' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos.' })
  @ApiResponse({ status: 500, description: 'Error en Pulumi (p. ej. keyName inexistente en AWS).' })
  async createVpcEc2(@Body() dto: CreateVpcEc2Dto) {
    return this.infraService.createVpcEc2(
      dto.keyName,
      dto.name ?? 'host-platform',
      dto.instanceType ?? 't3.micro',
    );
  }

  @Post('load-balancer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un Application Load Balancer (ALB) para la instancia EC2 existente' })
  @ApiResponse({
    status: 201,
    description: 'Load Balancer creado exitosamente. Retorna DNS name y ARN del ALB.',
    schema: {
      type: 'object',
      properties: {
        loadBalancerArn: { type: 'string', example: 'arn:aws:elasticloadbalancing:...' },
        loadBalancerDns: { type: 'string', example: 'host-platform-alb-123456789.us-east-1.elb.amazonaws.com' },
        targetGroupArn: { type: 'string' },
        httpListenerArn: { type: 'string' },
        httpsListenerArn: { type: 'string', nullable: true },
        vpcId: { type: 'string' },
        instanceId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos.' })
  @ApiResponse({
    status: 404,
    description: 'No se encontró la infraestructura VPC/EC2 con el nombre especificado.',
  })
  @ApiResponse({ status: 500, description: 'Error en Pulumi al crear el Load Balancer.' })
  async createLoadBalancer(@Body() dto: CreateLoadBalancerDto) {
    return this.infraService.createLoadBalancer(
      dto.name,
      dto.httpPort ?? 80,
      dto.httpsPort,
      dto.targetPort ?? 3000,
      dto.loadBalancerType ?? 'application',
    );
  }
}
