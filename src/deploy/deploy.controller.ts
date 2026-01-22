import { Controller, Post, Delete, Get, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { DeployService } from './deploy.service';
import { GithubService } from './github.service';
import { DeployDto } from './dto/deploy.dto';
import { CreateRepoDto } from './dto/create-repo.dto';
import { OrchestratorTokenGuard } from './guards/orchestrator-token.guard';

@ApiTags('deploy')
@Controller('deploy')
export class DeployController {
  constructor(
    private readonly deployService: DeployService,
    private readonly githubService: GithubService,
  ) {}

  @Post()
  @UseGuards(OrchestratorTokenGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desplegar un microservicio desde una imagen de Docker' })
  @ApiResponse({
    status: 401,
    description: 'Token de autorización inválido o faltante',
  })
  @ApiResponse({
    status: 201,
    description: 'Microservicio desplegado exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        url: { type: 'string', example: 'https://cliente1.boogiepop.cloud' },
        containerId: { type: 'string' },
        containerName: { type: 'string' },
        hostPort: { type: 'number' },
        internalPort: { type: 'number' },
        imageName: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Error en los datos proporcionados o durante el despliegue',
  })
  async deployMicroservice(@Body() deployDto: DeployDto) {
    return await this.deployService.deploy(
      deployDto.imageName,
      deployDto.subdomain,
      deployDto.internalPort,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar todos los microservicios desplegados' })
  @ApiResponse({
    status: 200,
    description: 'Lista de despliegues',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          containerId: { type: 'string' },
          containerName: { type: 'string' },
          subdomain: { type: 'string' },
          image: { type: 'string' },
          status: { type: 'string' },
          hostPort: { type: 'number' },
          createdAt: { type: 'number' },
        },
      },
    },
  })
  async listDeployments() {
    return this.deployService.listDeployments();
  }

  @Delete(':subdomain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un despliegue de microservicio' })
  @ApiParam({
    name: 'subdomain',
    description: 'El subdominio del despliegue a eliminar (sin el dominio base)',
    example: 'cliente1',
  })
  @ApiResponse({
    status: 200,
    description: 'Despliegue eliminado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'No se encontró un despliegue para el subdominio especificado',
  })
  async removeDeployment(@Param('subdomain') subdomain: string) {
    return this.deployService.removeDeployment(subdomain);
  }

  @Post('repo')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un repositorio de GitHub con pipeline de CI/CD configurado' })
  @ApiResponse({
    status: 201,
    description: 'Repositorio creado y pipeline configurado exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        url: { type: 'string', example: 'https://github.com/usuario/mi-microservicio' },
        full_name: { type: 'string', example: 'usuario/mi-microservicio' },
        name: { type: 'string', example: 'mi-microservicio' },
        subdomain: { type: 'string', example: 'cliente1.boogiepop.cloud' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Error en los datos proporcionados o durante la creación del repositorio',
  })
  async createNewProject(@Body() createRepoDto: CreateRepoDto) {
    return await this.githubService.createRepoAndSetupPipeline(
      createRepoDto.name,
      createRepoDto.subdomain,
      createRepoDto.private ?? false, // Por defecto público si no se especifica
    );
  }

  @Get('verify-token')
  @ApiOperation({ summary: 'Verificar el token de GitHub y sus permisos' })
  @ApiResponse({
    status: 200,
    description: 'Información del token y permisos',
    schema: {
      type: 'object',
      properties: {
        tokenConfigured: { type: 'boolean' },
        user: {
          type: 'object',
          properties: {
            login: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            type: { type: 'string' },
          },
        },
        organization: { type: 'object' },
        scopes: { type: 'array', items: { type: 'string' } },
        recommendations: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  async verifyToken() {
    return this.githubService.verifyToken();
  }
}
