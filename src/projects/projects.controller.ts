import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';

@ApiTags('Orquestador de Proyectos')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post('github')
  @ApiOperation({ summary: 'Crea solo el repositorio de GitHub desde template (sin Amplify)' })
  @ApiResponse({ status: 201, description: 'Repositorio creado y vite.config.ts actualizado.' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos.' })
  async createRepository(@Body() createProjectDto: CreateProjectDto) {
    const repoUrl = await this.projectsService.createRepositoryFromTemplate(
      createProjectDto.projectName,
      createProjectDto.description,
    );
    return { githubUrl: repoUrl, message: 'Repositorio creado exitosamente' };
  }

  @Post('amplify')
  @ApiOperation({ summary: 'Crea solo Amplify App (el repositorio debe existir previamente)' })
  @ApiResponse({ status: 201, description: 'Amplify App creada exitosamente.' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos.' })
  async createAmplify(@Body() createProjectDto: CreateProjectDto) {
    return await this.projectsService.createAmplifyApp(
      createProjectDto.projectName,
      createProjectDto.createS3 ?? false,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Crea repositorio y despliega infraestructura completa (GitHub + Amplify)' })
  @ApiResponse({ status: 201, description: 'Repositorio y Amplify creados exitosamente.' })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos.' })
  async create(@Body() createProjectDto: CreateProjectDto) {
    return await this.projectsService.createInfrastructure(
      createProjectDto.projectName,
      createProjectDto.description,
      createProjectDto.createS3
    );
  }
}
