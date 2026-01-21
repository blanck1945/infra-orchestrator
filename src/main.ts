import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Habilitar validaciones automáticas
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Elimina propiedades que no están en el DTO
      forbidNonWhitelisted: true, // Lanza error si hay propiedades no permitidas
      transform: true, // Transforma los objetos planos a instancias de DTO
      transformOptions: {
        enableImplicitConversion: true, // Convierte tipos automáticamente
      },
    }),
  );
  
  // Habilitar CORS para tu Front
  app.enableCors();
  
  // Configuración de Swagger
  const config = new DocumentBuilder()
    .setTitle('Infra Orchestrator API')
    .setDescription('API para gestionar proyectos de infraestructura con Pulumi, AWS y GitHub')
    .setVersion('1.0')
    .addTag('projects', 'Endpoints relacionados con la gestión de proyectos')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  
  await app.listen(process.env.PORT ?? 3000);
  console.log(`Backend corriendo en: http://localhost:${process.env.PORT ?? 3000}`);
  console.log(`Swagger UI disponible en: http://localhost:${process.env.PORT ?? 3000}/api`);
}
bootstrap();
