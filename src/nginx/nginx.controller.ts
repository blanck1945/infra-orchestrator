import { Controller, Post, Delete, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { NginxService } from './nginx.service';
import { CreateProxyConfigDto } from './dto/create-proxy-config.dto';

@ApiTags('nginx')
@Controller('nginx')
export class NginxController {
  constructor(private readonly nginxService: NginxService) {}

  @Post('proxy')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear configuración de proxy para un subdominio' })
  @ApiResponse({
    status: 201,
    description: 'Configuración creada exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        filePath: { type: 'string' },
        subdomain: { type: 'string' },
        port: { type: 'number' },
      },
    },
  })
  async createProxyConfig(@Body() dto: CreateProxyConfigDto) {
    return this.nginxService.createProxyConfig(dto.subdomain, dto.containerPort);
  }

  @Delete('proxy/:subdomain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar configuración de proxy para un subdominio' })
  @ApiParam({
    name: 'subdomain',
    description: 'El subdominio a eliminar (sin el dominio base)',
    example: 'mi-app',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración eliminada exitosamente',
  })
  async removeProxyConfig(@Param('subdomain') subdomain: string) {
    return this.nginxService.removeProxyConfig(subdomain);
  }

  @Get('proxy')
  @ApiOperation({ summary: 'Listar todas las configuraciones de proxy' })
  @ApiResponse({
    status: 200,
    description: 'Lista de configuraciones',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subdomain: { type: 'string' },
          port: { type: 'number' },
          filePath: { type: 'string' },
        },
      },
    },
  })
  async listProxyConfigs() {
    return this.nginxService.listProxyConfigs();
  }
}
