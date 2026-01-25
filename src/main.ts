import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // --- CAMBIO CLAVE PARA AWS ---
  // Esto hace que Nest responda en /orchestrator/... y no en la raíz
  app.setGlobalPrefix('orchestrator');
  
  // Habilitar CORS (Configuración recomendada para producción)
  app.enableCors({
    origin: '*', // En producción podrías poner 'https://boogiepop.cloud'
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  // -----------------------------

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  
  const config = new DocumentBuilder()
    .setTitle('Infra Orchestrator API')
    .setDescription('API para gestionar proyectos de infraestructura con Pulumi, AWS y GitHub')
    .setVersion('1.0')
    .addTag('projects')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Token',
        description: 'Ingresa tu ORCHESTRATOR_TOKEN',
      },
      'bearer',
    )
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  // Swagger también se moverá a /orchestrator/api
  SwaggerModule.setup('orchestrator/api', app, document);
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  
  console.log(`Backend corriendo en: http://localhost:${port}/orchestrator`);
  console.log(`Swagger UI disponible en: http://localhost:${port}/orchestrator/api`);
}
bootstrap();