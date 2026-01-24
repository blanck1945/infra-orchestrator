import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalWorkspace } from '@pulumi/pulumi/automation';
import * as pulumi from '@pulumi/pulumi';
import * as aws from "@pulumi/aws";
import { Octokit } from '@octokit/rest';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(private configService: ConfigService) {}

  /**
   * Crea un repositorio desde template y actualiza vite.config.ts
   * Método separado para pruebas granulares
   */
  async createRepositoryFromTemplate(
    projectName: string,
    description?: string,
  ): Promise<string> {
    const githubToken = this.configService.get('GITHUB_TOKEN');
    const templateOwner = this.configService.get('GITHUB_TEMPLATE_OWNER');
    const templateRepo = this.configService.get('GITHUB_TEMPLATE_REPO');
    const defaultOrg = 'host-repositories';
    const githubOrg = this.configService.get('GITHUB_ORG') || defaultOrg;

    // Validar que las variables estén configuradas
    if (!templateOwner || templateOwner === 'tu-organizacion') {
      throw new Error('GITHUB_TEMPLATE_OWNER no está configurado o tiene un valor placeholder. Actualiza tu .env con el owner real del template.');
    }
    if (!templateRepo || templateRepo === 'tu-template-vite-federation') {
      throw new Error('GITHUB_TEMPLATE_REPO no está configurado o tiene un valor placeholder. Actualiza tu .env con el nombre real del template.');
    }
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN no está configurado en el .env');
    }

    const octokit = new Octokit({ auth: githubToken });

    this.logger.log(`Creando repositorio ${projectName} desde template ${templateOwner}/${templateRepo}...`);

    try {
      // 1. Crear repositorio desde template
      const repoResponse = await octokit.rest.repos.createUsingTemplate({
        template_owner: templateOwner!,
        template_repo: templateRepo!,
        name: projectName,
        owner: githubOrg!,
        description: description || 'Creado vía API',
        private: false,
      });

      this.logger.log(`Repositorio creado: ${repoResponse.data.html_url}`);

      // 2. Esperar a que GitHub procese el template
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // 3. Leer vite.config.ts
      this.logger.log('Leyendo vite.config.ts...');
      const viteConfigResponse = await octokit.rest.repos.getContent({
        owner: githubOrg!,
        repo: projectName,
        path: 'vite.config.ts',
      });

      if (Array.isArray(viteConfigResponse.data) || viteConfigResponse.data.type !== 'file') {
        throw new Error('vite.config.ts no encontrado o no es un archivo');
      }

      const fileSha = viteConfigResponse.data.sha;

      // 4. Generar el contenido completo del vite.config.ts con Module Federation
      // Sanitizar el nombre: solo minúsculas, números y guiones
      const sanitizedProjectName = projectName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      const remoteName = sanitizedProjectName;

      // Generar el contenido completo del vite.config.ts
      const finalContent = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import federation from "@originjs/vite-plugin-federation";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), federation({
    name: "${remoteName}",
    filename: "remoteEntry.js",
    exposes: {
      "./App": "./src/App",
    },
    shared: {
      react: {
        singleton: true,
        requiredVersion: false,
      },
      "react-dom": {
        singleton: true,
        requiredVersion: false,
      },
    },
  })],
  build: {
    target: "esnext",
    minify: false,
    cssCodeSplit: false,
    modulePreload: false,
  },
});
`;

      // 5. Hacer commit del cambio
      this.logger.log(`Actualizando vite.config.ts con remote name: ${remoteName}...`);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: githubOrg!,
        repo: projectName,
        path: 'vite.config.ts',
        message: `chore: setup federation name to ${remoteName}`,
        content: Buffer.from(finalContent).toString('base64'),
        sha: fileSha,
        branch: 'main',
      });

      this.logger.log('vite.config.ts actualizado exitosamente');

      return repoResponse.data.html_url;
    } catch (error) {
      this.logger.error(`Error al crear repo desde template: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Crea solo Amplify (asume que el repositorio ya existe)
   */
  async createAmplifyApp(projectName: string, createS3: boolean = false) {
    const githubToken = this.configService.get('GITHUB_TOKEN');
    const templateOwner = this.configService.get('GITHUB_TEMPLATE_OWNER');
    const defaultOrg = 'host-repositories';
    const githubOrg = this.configService.get('GITHUB_ORG') || defaultOrg;

    // Validar que el repositorio existe antes de crear Amplify
    const octokit = new Octokit({ auth: githubToken });
    try {
      await octokit.rest.repos.get({
        owner: githubOrg!,
        repo: projectName,
      });
      this.logger.log(`Repositorio ${githubOrg}/${projectName} encontrado, procediendo con Amplify...`);
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        throw new Error(
          `El repositorio ${githubOrg}/${projectName} no existe en GitHub. ` +
          `Primero crea el repositorio usando POST /projects/github o crea el repositorio manualmente.`
        );
      }
      throw error;
    }

    const pulumiProgram = async () => {
      // 1. Ahorro de Costos: Etiquetas para seguimiento
      const commonTags = { "Project": projectName, "ManagedBy": "NestJS-Orchestrator" };

      // El repositorio ya existe, solo necesitamos la URL
      const repoUrlString = `https://github.com/${githubOrg}/${projectName}`;
      const repoUrl = pulumi.output(repoUrlString);

      // 2. AWS Amplify (Hosting)
      const amplifyApp = new aws.amplify.App(projectName, {
        repository: repoUrl,
        accessToken: githubToken,
        platform: "WEB",
        
        // Aquí definimos el archivo de compilación por defecto para Vite
        buildSpec: `
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
`,
        
        // Reglas personalizadas para SPA: redirige todas las rutas a index.html
        customRules: [
          {
            source: "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
            status: "200",
            target: "/index.html",
          },
        ],
        
        enableBranchAutoBuild: true,
        tags: commonTags,
      });

      new aws.amplify.Branch("main", {
        appId: amplifyApp.id,
        branchName: "main",
        tags: commonTags,
      });

      // 4. S3 Opcional
      let s3Uri = pulumi.output("");
      if (createS3 === true) {
        const bucket = new aws.s3.BucketV2(`${projectName}-data`, {
          bucket: `${projectName}-${Math.random().toString(36).substring(7)}`,
          tags: commonTags,
        });
        s3Uri = bucket.id.apply(id => `s3://${id}`);
      }

      return { 
        githubUrl: repoUrlString, 
        amplifyUrl: amplifyApp.defaultDomain.apply(d => `https://main.${d}`), 
        s3Uri 
      };
    };

    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: 'dev',
      projectName: projectName,
      program: pulumiProgram,
    });

    await stack.setConfig("aws:region", { value: this.configService.get('AWS_REGION') || 'us-east-1' });
    this.logger.log(`Creando Amplify App para ${projectName}...`);
    const upRes = await stack.up({ onOutput: (msg) => this.logger.debug(msg) });
    
    const outputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(upRes.outputs)) {
      outputs[k] = (v as { value?: unknown })?.value ?? v;
    }
    
    return outputs;
  }

  async createInfrastructure(projectName: string, description: string | undefined, createS3: boolean | undefined) {
    // 1. Crear repositorio desde template (reutiliza el método)
    await this.createRepositoryFromTemplate(projectName, description);

    // 2. Crear Amplify (reutiliza el método)
    return await this.createAmplifyApp(projectName, createS3 ?? false);
  }
}
