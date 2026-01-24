import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Response } from 'express';
import { join } from 'path';
import { readFileSync } from 'fs';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Endpoint raíz de la API' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('cost')
  @ApiOperation({ 
    summary: 'Página HTML con información de costos de AWS',
    description: 'Retorna una página HTML interactiva con el desglose de costos mensuales estimados para los servicios AWS utilizados en la plataforma.'
  })
  getCostsPage(@Res() res: Response) {
    const filePath = join(process.cwd(), 'public', 'aws-costs.html');
    try {
      const html = readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      res.status(404).send('Página de costos no encontrada');
    }
  }

  @Get('architecture')
  @ApiOperation({ 
    summary: 'Página HTML con diagrama de arquitectura AWS',
    description: 'Retorna una página HTML con un diagrama visual de la arquitectura desplegada en AWS, incluyendo VPC, subnets, load balancer, EC2 y security groups.'
  })
  getArchitecturePage(@Res() res: Response) {
    const filePath = join(process.cwd(), 'public', 'architecture.html');
    try {
      const html = readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      res.status(404).send('Página de arquitectura no encontrada');
    }
  }
}
