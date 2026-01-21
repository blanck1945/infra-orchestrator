import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InfraService } from './infra.service';
import { CreateVpcEc2Dto } from './dto/create-vpc-ec2.dto';

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
}
