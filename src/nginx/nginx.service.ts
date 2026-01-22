import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getNginxConfig } from './nginx-template';

const execPromise = promisify(exec);

@Injectable()
export class NginxService {
  private readonly logger = new Logger(NginxService.name);
  private readonly nginxPath: string;

  constructor(private configService: ConfigService) {
    // Permite configurar la ruta de nginx desde variables de entorno
    // Por defecto usa /etc/nginx/conf.d (ruta estándar en contenedores/hosts)
    this.nginxPath = this.configService.get('NGINX_CONF_PATH') || '/etc/nginx/conf.d';
  }

  /**
   * Crea una configuración de proxy para un subdominio
   * @param subdomain - El subdominio (sin el dominio base)
   * @param containerPort - El puerto del contenedor al que se hará proxy
   * @returns Objeto con el resultado de la operación
   */
  async createProxyConfig(subdomain: string, containerPort: number) {
    this.logger.log(`Creando configuración de proxy para ${subdomain} en puerto ${containerPort}`);

    // Validar que el subdominio sea válido
    if (!subdomain || !/^[a-z0-9-]+$/.test(subdomain)) {
      throw new Error(
        `Subdominio inválido: ${subdomain}. Solo se permiten letras minúsculas, números y guiones.`
      );
    }

    // Validar que el puerto sea válido
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
      throw new Error(`Puerto inválido: ${containerPort}. Debe ser un número entre 1 y 65535.`);
    }

    const config = getNginxConfig(subdomain, containerPort);
    const filePath = `${this.nginxPath}/${subdomain}.conf`;

    try {
      // Asegurar que el directorio existe
      if (!fs.existsSync(this.nginxPath)) {
        this.logger.warn(`El directorio ${this.nginxPath} no existe. Intentando crearlo...`);
        fs.mkdirSync(this.nginxPath, { recursive: true });
      }

      // 1. Escribir el archivo en el volumen compartido
      fs.writeFileSync(filePath, config, 'utf8');
      this.logger.log(`Archivo de configuración creado: ${filePath}`);

      // 2. Recargar Nginx para que reconozca el nuevo subdominio
      // Nota: Esto requiere que Nginx esté corriendo en el host o en otro contenedor
      // y que el contenedor tenga permisos para ejecutar nginx -s reload
      try {
        await execPromise('nginx -s reload');
        this.logger.log('Nginx recargado exitosamente');
      } catch (reloadError) {
        this.logger.warn(
          `No se pudo recargar Nginx automáticamente: ${(reloadError as Error).message}. ` +
          `El archivo de configuración fue creado pero necesitarás recargar Nginx manualmente.`
        );
        // No lanzamos el error porque el archivo sí se creó correctamente
      }

      return {
        success: true,
        message: `Configuración creada para ${subdomain}.boogiepop.cloud`,
        filePath,
        subdomain: `${subdomain}.boogiepop.cloud`,
        port: containerPort,
      };
    } catch (error) {
      this.logger.error(`Error configurando Nginx: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Elimina una configuración de proxy
   * @param subdomain - El subdominio a eliminar
   */
  async removeProxyConfig(subdomain: string) {
    this.logger.log(`Eliminando configuración de proxy para ${subdomain}`);

    const filePath = `${this.nginxPath}/${subdomain}.conf`;

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`La configuración para ${subdomain} no existe`);
      }

      // Eliminar el archivo
      fs.unlinkSync(filePath);
      this.logger.log(`Archivo de configuración eliminado: ${filePath}`);

      // Recargar Nginx
      try {
        await execPromise('nginx -s reload');
        this.logger.log('Nginx recargado exitosamente');
      } catch (reloadError) {
        this.logger.warn(
          `No se pudo recargar Nginx automáticamente: ${(reloadError as Error).message}. ` +
          `El archivo fue eliminado pero necesitarás recargar Nginx manualmente.`
        );
      }

      return {
        success: true,
        message: `Configuración eliminada para ${subdomain}.boogiepop.cloud`,
        subdomain: `${subdomain}.boogiepop.cloud`,
      };
    } catch (error) {
      this.logger.error(`Error eliminando configuración de Nginx: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Lista todas las configuraciones existentes
   */
  async listProxyConfigs() {
    try {
      if (!fs.existsSync(this.nginxPath)) {
        return [];
      }

      const files = fs.readdirSync(this.nginxPath);
      const configs = files
        .filter((file) => file.endsWith('.conf'))
        .map((file) => {
          const subdomain = file.replace('.conf', '');
          const filePath = `${this.nginxPath}/${file}`;
          const content = fs.readFileSync(filePath, 'utf8');
          
          // Extraer el puerto de la configuración
          const portMatch = content.match(/proxy_pass http:\/\/localhost:(\d+)/);
          const port = portMatch ? parseInt(portMatch[1], 10) : null;

          return {
            subdomain: `${subdomain}.boogiepop.cloud`,
            port,
            filePath,
          };
        });

      return configs;
    } catch (error) {
      this.logger.error(`Error listando configuraciones: ${(error as Error).message}`);
      throw error;
    }
  }
}
