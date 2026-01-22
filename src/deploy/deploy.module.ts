import { Module } from '@nestjs/common';
import { DeployService } from './deploy.service';
import { GithubService } from './github.service';
import { DeployController } from './deploy.controller';
import { OrchestratorTokenGuard } from './guards/orchestrator-token.guard';
import { NginxModule } from '../nginx/nginx.module';

@Module({
  imports: [NginxModule], // Importar NginxModule para usar NginxService
  controllers: [DeployController],
  providers: [DeployService, GithubService, OrchestratorTokenGuard],
  exports: [DeployService, GithubService], // Exportar para que otros módulos puedan usarlos
})
export class DeployModule {}
