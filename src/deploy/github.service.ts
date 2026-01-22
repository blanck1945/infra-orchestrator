import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import * as sodium from 'libsodium-wrappers';

export interface OrgInfo {
  name: string;
  displayName?: string;
  exists: boolean;
  message?: string;
  error?: string;
}

export interface OrgAccess {
  role?: string | null;
  state?: string | null;
  canCreateRepos: boolean;
  message?: string;
  error?: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);
  private octokit: Octokit;

  constructor(private configService: ConfigService) {
    const githubToken = this.configService.get('GITHUB_TOKEN');
    
    if (!githubToken) {
      this.logger.warn('GITHUB_TOKEN no está configurado. Las operaciones de GitHub fallarán.');
    }
    
    this.octokit = new Octokit({ auth: githubToken });
  }

  /**
   * Verifica el token de GitHub y sus permisos
   * @returns Información sobre el token y sus permisos
   */
  async verifyToken() {
    const githubToken = this.configService.get('GITHUB_TOKEN');
    const githubOrg = this.configService.get('GITHUB_ORG');

    if (!githubToken) {
      throw new BadRequestException('GITHUB_TOKEN no está configurado en el .env');
    }

    try {
      // Obtener información del usuario autenticado
      const { data: user } = await this.octokit.users.getAuthenticated();

      // Intentar obtener información de la organización si está configurada
      let orgInfo: OrgInfo | null = null;
      let orgAccess: OrgAccess | null = null;

      if (githubOrg) {
        try {
          const { data: org } = await this.octokit.orgs.get({ org: githubOrg });
          orgInfo = {
            name: org.login,
            displayName: org.name || undefined,
            exists: true,
          };

          // Verificar si el usuario es miembro de la organización
          try {
            const { data: membership } = await this.octokit.orgs.getMembershipForAuthenticatedUser({
              org: githubOrg,
            });
            orgAccess = {
              role: membership.role,
              state: membership.state,
              canCreateRepos: membership.role === 'admin' || membership.role === 'member',
            };
          } catch (membershipError: any) {
            if (membershipError.status === 404) {
              orgAccess = {
                role: null,
                state: null,
                canCreateRepos: false,
                message: 'No eres miembro de esta organización',
              };
            } else {
              orgAccess = {
                canCreateRepos: false,
                error: membershipError.message,
              };
            }
          }
        } catch (orgError: any) {
          if (orgError.status === 404) {
            orgInfo = {
              name: githubOrg,
              exists: false,
              message: 'La organización no existe o no tienes acceso',
            };
          } else {
            orgInfo = {
              name: githubOrg,
              exists: false,
              error: orgError.message,
            };
          }
        }
      }

      return {
        tokenConfigured: true,
        user: {
          login: user.login,
          name: user.name || undefined,
          email: user.email || undefined,
          type: user.type,
        },
        organization: orgInfo
          ? {
              name: orgInfo.name,
              displayName: orgInfo.displayName,
              exists: orgInfo.exists,
              message: orgInfo.message,
              error: orgInfo.error,
              access: orgAccess,
            }
          : null,
        recommendations: this.getRecommendations(orgInfo, orgAccess),
      };
    } catch (error: any) {
      this.logger.error(`Error verificando token: ${error.message}`);
      throw new BadRequestException(
        `Error al verificar el token: ${error.message}. Verifica que el token sea válido.`
      );
    }
  }

  /**
   * Genera recomendaciones basadas en la verificación del token
   */
  private getRecommendations(orgInfo: any, orgAccess: any): string[] {
    const recommendations: string[] = [];

    if (orgInfo && !orgInfo.exists) {
      recommendations.push(
        `La organización "${orgInfo.name}" no existe o no tienes acceso. ` +
        `Elimina GITHUB_ORG de tu .env para crear repos en tu cuenta personal.`
      );
    }

    if (orgAccess && !orgAccess.canCreateRepos) {
      recommendations.push(
        `No tienes permisos para crear repositorios en la organización "${orgInfo?.name}". ` +
        `Necesitas ser admin o tener permisos de escritura. ` +
        `Alternativa: Elimina GITHUB_ORG de tu .env para crear repos en tu cuenta personal.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('Todo parece estar configurado correctamente.');
    }

    return recommendations;
  }

  /**
   * Crea un repositorio en GitHub y configura el pipeline de CI/CD automático
   * @param repoName - Nombre del repositorio a crear
   * @param subdomain - Subdominio que se usará para el despliegue
   * @param isPrivate - Si el repositorio debe ser privado (por defecto false = público)
   * @returns Información del repositorio creado
   */
  async createRepoAndSetupPipeline(repoName: string, subdomain: string, isPrivate: boolean = false) {
    const visibility = isPrivate ? 'privado' : 'público';
    this.logger.log(`Creando repositorio ${visibility} ${repoName} con pipeline para subdominio ${subdomain}`);

    const githubToken = this.configService.get('GITHUB_TOKEN');
    const githubOrg = this.configService.get('GITHUB_ORG');

    if (!githubToken) {
      throw new BadRequestException('GITHUB_TOKEN no está configurado en el .env');
    }

    try {
      // 1. Crear el repositorio desde el template blanck1945/template-be
      const templateOwner = 'blanck1945';
      const templateRepo = 'template-be';
      
      this.logger.log(`Creando repositorio desde template: ${templateOwner}/${templateRepo}`);
      
      // Determinar el owner (organización o usuario)
      const { data: authenticatedUser } = await this.octokit.users.getAuthenticated();
      const owner = githubOrg || authenticatedUser.login;
      
      let repo;
      try {
        repo = await this.octokit.repos.createUsingTemplate({
          template_owner: templateOwner,
          template_repo: templateRepo,
          name: repoName,
          owner: owner,
          private: isPrivate,
          description: `Microservicio desplegado en ${subdomain}.boogiepop.cloud`,
        });
        this.logger.log(`Repositorio creado exitosamente desde template: ${repo.data.html_url}`);
      } catch (templateError: any) {
        if (templateError.status === 422) {
          throw new BadRequestException(
            `El repositorio "${repoName}" ya existe. Por favor, elige otro nombre o elimina el repositorio existente.`
          );
        }
        throw new BadRequestException(
          `No se pudo crear el repositorio desde el template: ${templateError.message}`
        );
      }

      const createdRepoName = repo.data.name;

      // 2. Esperar a que GitHub procese el template (el template ya viene con contenido)
      this.logger.log('Esperando a que GitHub procese el template...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // 3. Generar el contenido del workflow YAML
      const workflowContent = this.generateWorkflowYaml(subdomain);

      // 4. Crear la carpeta .github/workflows y el archivo deploy.yml
      this.logger.log('Creando archivo de workflow .github/workflows/deploy.yml');

      // Crear el archivo del workflow (sobrescribirá si ya existe)
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: createdRepoName,
        path: '.github/workflows/deploy.yml',
        message: 'ci: setup automatic deployment pipeline',
        content: Buffer.from(workflowContent).toString('base64'),
        branch: 'main',
      });

      this.logger.log('Pipeline de CI/CD configurado exitosamente');

      // 5. Esperar un momento para que GitHub procese el workflow
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // 6. Crear o actualizar el Dockerfile multi-stage para producción
      const dockerfileContent = this.generateDockerfile();
      const dockerfileSha = await this.getFileSha(owner, createdRepoName, 'Dockerfile', 'main');
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: createdRepoName,
        path: 'Dockerfile',
        message: 'Add Dockerfile for application build',
        content: Buffer.from(dockerfileContent).toString('base64'),
        branch: 'main',
        ...(dockerfileSha ? { sha: dockerfileSha } : {}),
      });
      this.logger.log('Dockerfile creado/actualizado.');

      // 7. Actualizar el README con instrucciones de despliegue
      const readmeContent = this.generateReadme(repoName, subdomain);
      const readmeSha = await this.getFileSha(owner, createdRepoName, 'README.md', 'main');
      await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo: createdRepoName,
        path: 'README.md',
        message: 'docs: update README with deployment instructions',
        content: Buffer.from(readmeContent).toString('base64'),
        branch: 'main',
        ...(readmeSha ? { sha: readmeSha } : {}),
      });

      this.logger.log('README.md actualizado');

      // 8. Crear los secrets si están configurados
      const dockerhubUsername = this.configService.get('DOCKERHUB_USERNAME');
      const dockerhubToken = this.configService.get('DOCKERHUB_TOKEN');
      const orchestratorToken = this.configService.get('ORCHESTRATOR_TOKEN');

      if (dockerhubUsername && dockerhubToken && dockerhubUsername.trim() && dockerhubToken.trim()) {
        await this.createRepositorySecret(owner, createdRepoName, 'DOCKERHUB_USERNAME', dockerhubUsername.trim());
        await this.createRepositorySecret(owner, createdRepoName, 'DOCKERHUB_TOKEN', dockerhubToken.trim());
        this.logger.log('Secrets de Docker Hub configurados');
      } else {
        this.logger.warn('DOCKERHUB_USERNAME o DOCKERHUB_TOKEN no están configurados o están vacíos. Los secrets no se crearán automáticamente.');
      }

      if (orchestratorToken && orchestratorToken.trim()) {
        await this.createRepositorySecret(owner, createdRepoName, 'ORCHESTRATOR_TOKEN', orchestratorToken.trim());
        this.logger.log('Secret ORCHESTRATOR_TOKEN configurado');
      } else {
        this.logger.warn('ORCHESTRATOR_TOKEN no está configurado o está vacío. El secret no se creará automáticamente.');
      }

      return {
        success: true,
        url: repo.data.html_url,
        full_name: repo.data.full_name,
        name: repo.data.name,
        subdomain: `${subdomain}.boogiepop.cloud`,
        message: `Repositorio creado y pipeline configurado. ${dockerhubUsername && dockerhubToken && orchestratorToken ? 'Todos los secrets fueron configurados automáticamente.' : 'Algunos secrets deben configurarse manualmente en GitHub.'}`,
      };
    } catch (error: any) {
      this.logger.error(`Error creando repositorio: ${error.message}`, error.stack);
      
      // Si el error es que el repositorio ya existe, dar un mensaje más claro
      if (error.status === 422 && error.message?.includes('already exists')) {
        throw new BadRequestException(
          `El repositorio ${repoName} ya existe. Por favor, elige otro nombre.`
        );
      }
      
      // Si el error es 404 al crear archivos, puede ser un problema de permisos o rama
      if (error.status === 404 && error.message?.includes('create-or-update-file-contents')) {
        throw new BadRequestException(
          `No se pudo crear archivos en el repositorio. ` +
          `Posibles causas: 1) El repositorio no tiene una rama inicial, 2) Permisos insuficientes, ` +
          `3) El token no tiene el scope 'repo' completo. ` +
          `Error: ${error.message}`
        );
      }
      
      // Si el error es 404 y hay una organización configurada, dar un mensaje más específico
      if (error.status === 404 && githubOrg && error.message?.includes('organization')) {
        throw new BadRequestException(
          `No se pudo crear el repositorio en la organización "${githubOrg}". ` +
          `Verifica que: 1) La organización existe, 2) Tu token tiene permisos para crear repositorios en la organización, ` +
          `3) El token tiene el scope 'write:org' o 'admin:org'. ` +
          `Sugerencia: Elimina GITHUB_ORG de tu .env para crear el repo en tu cuenta personal.`
        );
      }
      
      throw new BadRequestException(
        `Error al crear el repositorio: ${error.message}`
      );
    }
  }

  /**
   * Genera el contenido del workflow YAML para CI/CD
   */
  private generateWorkflowYaml(subdomain: string): string {
    return `name: Docker Build and Deploy

on:
  push:
    branches: [ main ]

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Verify Docker Hub secrets
        run: |
          if [ -z "\${{ secrets.DOCKERHUB_USERNAME }}" ]; then
            echo "Error: DOCKERHUB_USERNAME secret is not set"
            exit 1
          fi
          if [ -z "\${{ secrets.DOCKERHUB_TOKEN }}" ]; then
            echo "Error: DOCKERHUB_TOKEN secret is not set"
            exit 1
          fi
          echo "Docker Hub secrets are configured"
      
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKERHUB_USERNAME }}
          password: \${{ secrets.DOCKERHUB_TOKEN }}
          logout: false
      
      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: \${{ secrets.DOCKERHUB_USERNAME }}/${subdomain}:latest

  notify-orchestrator:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - name: Call Orchestrator Deploy
        env:
          IMAGE_NAME: \${{ secrets.DOCKERHUB_USERNAME }}/${subdomain}:latest
          SUBDOMAIN: ${subdomain}
        run: |
          curl -X POST https://boogiepop.cloud/api/deploy \\
            -H "Authorization: Bearer \${{ secrets.ORCHESTRATOR_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d '{"imageName": "$IMAGE_NAME", "subdomain": "$SUBDOMAIN", "internalPort": 3000}'
`;
  }

  /**
   * Crea o actualiza un secret en el repositorio de GitHub
   * @param owner - Propietario del repositorio
   * @param repo - Nombre del repositorio
   * @param secretName - Nombre del secret
   * @param secretValue - Valor del secret (se encriptará automáticamente)
   */
  async createRepositorySecret(owner: string, repo: string, secretName: string, secretValue: string) {
    try {
      // 1. Obtener la clave pública del repo
      const { data: publicKey } = await this.octokit.actions.getRepoPublicKey({ owner, repo });

      // 2. Encriptar el valor para GitHub
      await sodium.ready;
      const binKey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
      const binSec = sodium.from_string(secretValue);
      const encBytes = sodium.crypto_box_seal(binSec, binKey);
      const encryptedValue = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);

      // 3. Crear el secret
      await this.octokit.actions.createOrUpdateRepoSecret({
        owner,
        repo,
        secret_name: secretName,
        encrypted_value: encryptedValue,
        key_id: publicKey.key_id,
      });
      
      this.logger.log(`Secret ${secretName} creado con éxito`);
    } catch (error: any) {
      this.logger.error(`Error creando secret ${secretName}: ${error.message}`);
      throw new BadRequestException(
        `No se pudo crear el secret ${secretName}: ${error.message}`
      );
    }
  }

  /**
   * Obtiene el SHA de un archivo si existe en el repositorio
   * @param owner - Propietario del repositorio
   * @param repo - Nombre del repositorio
   * @param path - Ruta del archivo
   * @param branch - Rama del repositorio
   * @returns SHA del archivo o null si no existe
   */
  private async getFileSha(owner: string, repo: string, path: string, branch: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      return data.sha;
    } catch (error: any) {
      // Si el archivo no existe (404), retornar null
      if (error.status === 404) {
        return null;
      }
      // Para otros errores, loguear pero no fallar
      this.logger.warn(`No se pudo obtener SHA de ${path}: ${error.message}`);
      return null;
    }
  }

  /**
   * Genera el contenido del Dockerfile multi-stage para producción
   * Dockerfile optimizado para NestJS
   */
  private generateDockerfile(): string {
    return `# Stage 1: Build
FROM node:20-alpine AS builder

# Instalamos pnpm globalmente
RUN npm install -g pnpm

WORKDIR /app

# Copiamos archivos de configuración de pnpm y dependencias
COPY pnpm-lock.yaml package.json ./

# Instalamos todas las dependencias (incluyendo devDeps para el build)
RUN pnpm install --frozen-lockfile

# Copiamos el resto del código y construimos
COPY . .
RUN pnpm run build

# Stage 2: Runtime (Imagen final ligera)
FROM node:20-alpine

RUN npm install -g pnpm
WORKDIR /app

# Copiamos solo lo necesario desde el builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Comando para producción
CMD ["pnpm", "run", "start:prod"]
`;
  }

  /**
   * Genera un README básico con instrucciones
   */
  private generateReadme(repoName: string, subdomain: string): string {
    return `# ${repoName}

Microservicio desplegado automáticamente en \`${subdomain}.boogiepop.cloud\`

## Configuración de Secrets en GitHub

Para que el pipeline funcione correctamente, asegúrate de configurar los siguientes secrets en la configuración del repositorio:

1. \`DOCKERHUB_USERNAME\`: Tu nombre de usuario de Docker Hub
2. \`DOCKERHUB_TOKEN\`: Tu token de acceso de Docker Hub
3. \`ORCHESTRATOR_TOKEN\`: Token de autenticación para el orquestador

## Despliegue Automático

Cada push a la rama \`main\` activará:
1. Build de la imagen Docker
2. Push a Docker Hub
3. Despliegue automático en el orquestador

## Desarrollo Local

\`\`\`bash
# Instalar dependencias
npm install

# Ejecutar en desarrollo
npm run dev

# Build
npm run build
\`\`\`
`;
  }
}
