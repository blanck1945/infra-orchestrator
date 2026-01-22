import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Docker from 'dockerode';
import { NginxService } from '../nginx/nginx.service';

@Injectable()
export class DeployService {
  private readonly logger = new Logger(DeployService.name);
  private docker: Docker;

  constructor(
    private nginxService: NginxService,
    private configService: ConfigService,
  ) {
    // Inicializar Docker client
    // Detectar la configuración correcta según el sistema operativo
    // Nota: En desarrollo (Windows) usará Docker Desktop, en producción (EC2 Linux) usará el socket Unix
    const dockerSocketPath = this.configService.get('DOCKER_SOCKET_PATH');
    const dockerHost = this.configService.get('DOCKER_HOST');
    
    if (dockerSocketPath) {
      // Si está configurado explícitamente, usarlo (útil para override en producción)
      this.logger.log(`Usando socket de Docker configurado: ${dockerSocketPath}`);
      this.docker = new Docker({ socketPath: dockerSocketPath });
    } else if (dockerHost) {
      // Si está configurado DOCKER_HOST (para TCP o remote), usarlo
      this.logger.log(`Usando Docker host configurado: ${dockerHost}`);
      this.docker = new Docker({ host: dockerHost });
    } else {
      // Detectar automáticamente según el sistema operativo
      const isWindows = process.platform === 'win32';
      const defaultSocket = isWindows 
        ? '\\\\.\\pipe\\docker_engine' // Named pipe de Docker Desktop en Windows
        : '/var/run/docker.sock'; // Unix socket en Linux (EC2)
      
      this.logger.log(
        `Sistema detectado: ${process.platform} (${isWindows ? 'Windows - Desarrollo' : 'Linux - Producción'}), ` +
        `usando socket: ${defaultSocket}`
      );
      this.docker = new Docker({ socketPath: defaultSocket });
    }
  }

  /**
   * Despliega un microservicio desde una imagen de Docker
   * @param imageName - Nombre de la imagen (ej: 'usuario/imagen:tag')
   * @param subdomain - Subdominio para el proxy (ej: 'cliente1')
   * @param internalPort - Puerto interno del contenedor
   * @returns Información del despliegue
   */
  async deploy(imageName: string, subdomain: string, internalPort: number) {
    this.logger.log(`Iniciando despliegue de ${imageName} para subdominio ${subdomain}`);

    // Verificar conexión con Docker antes de continuar
    try {
      await this.docker.ping();
    } catch (error) {
      const errorMessage = (error as Error).message;
      this.logger.error(`No se pudo conectar con Docker: ${errorMessage}`);
      
      const platform = process.platform;
      let suggestion = '';
      
      if (platform === 'win32') {
        suggestion = 
          'En Windows (desarrollo), asegúrate de que Docker Desktop esté corriendo y arrancado. ' +
          'Verifica en la bandeja del sistema que Docker Desktop esté activo. ' +
          'Si usas WSL2, puedes configurar DOCKER_SOCKET_PATH=/var/run/docker.sock en tu .env. ' +
          'Nota: En producción (EC2 Linux) se usará automáticamente /var/run/docker.sock';
      } else if (platform === 'linux') {
        suggestion = 
          'En Linux, verifica que Docker esté corriendo y que tengas permisos para acceder a /var/run/docker.sock. ' +
          'Puedes agregar tu usuario al grupo docker: sudo usermod -aG docker $USER';
      } else {
        suggestion = 
          'Verifica que Docker esté corriendo y accesible. ' +
          'Configura DOCKER_SOCKET_PATH o DOCKER_HOST en tu .env si es necesario';
      }
      
      throw new BadRequestException(
        `No se pudo conectar con Docker: ${errorMessage}. ${suggestion}`
      );
    }

    try {
      // 1. Verificar si el contenedor ya existe y detenerlo/eliminarlo si es necesario
      const existingContainerName = `container-${subdomain}`;
      try {
        const existingContainer = this.docker.getContainer(existingContainerName);
        const containerInfo = await existingContainer.inspect();
        
        if (containerInfo.State.Running) {
          this.logger.log(`Deteniendo contenedor existente: ${existingContainerName}`);
          await existingContainer.stop();
        }
        
        this.logger.log(`Eliminando contenedor existente: ${existingContainerName}`);
        await existingContainer.remove();
      } catch (error: any) {
        // Si el contenedor no existe, continuar normalmente
        if (error.statusCode !== 404) {
          this.logger.warn(`Error al verificar contenedor existente: ${error.message}`);
        }
      }

      // 2. Preparar autenticación con Docker Hub si las credenciales están configuradas
      const dockerhubUsername = this.configService.get('DOCKERHUB_USERNAME');
      const dockerhubToken = this.configService.get('DOCKERHUB_TOKEN');
      
      const authconfig = dockerhubUsername && dockerhubToken
        ? {
            username: dockerhubUsername,
            password: dockerhubToken,
            serveraddress: 'https://index.docker.io/v1/',
          }
        : undefined;

      if (authconfig) {
        this.logger.log('Usando credenciales de Docker Hub para autenticación');
      } else {
        this.logger.warn('DOCKERHUB_USERNAME o DOCKERHUB_TOKEN no están configurados. Intentando pull sin autenticación (puede fallar para imágenes privadas)...');
      }

      // 3. Descargar la imagen de Docker Hub (o usar la local si existe)
      this.logger.log(`Descargando imagen: ${imageName}`);
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(imageName, authconfig ? { authconfig } : {}, (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) {
            return reject(err);
          }

          this.docker.modem.followProgress(stream, (err: Error) => {
            if (err) {
              return reject(err);
            }
            this.logger.log(`Imagen ${imageName} descargada exitosamente`);
            resolve();
          }, (event: any) => {
            // Log del progreso opcional
            if (event.status && event.progress) {
              this.logger.debug(`${event.status}: ${event.progress}`);
            }
          });
        });
      });

      // 4. Definir un puerto único en el host (rango 3003-4000)
      // Verifica contenedores activos para evitar colisiones
      const hostPort = await this.findAvailablePort(3003, 4000);
      this.logger.log(`Asignando puerto del host: ${hostPort}`);

      // 5. Crear el contenedor con límites de memoria (Vital para t3.micro)
      const memoryLimit = this.configService.get<number>('CONTAINER_MEMORY_LIMIT_MB') || 256;
      this.logger.log(`Creando contenedor con límite de memoria: ${memoryLimit}MB`);

      const container = await this.docker.createContainer({
        Image: imageName,
        name: existingContainerName,
        HostConfig: {
          PortBindings: {
            [`${internalPort}/tcp`]: [{ HostPort: `${hostPort}` }],
          },
          Memory: memoryLimit * 1024 * 1024, // Convertir MB a bytes
          MemorySwap: memoryLimit * 2 * 1024 * 1024, // Permitir swap (el doble de la memoria) para evitar OOM Killer
          RestartPolicy: { Name: 'unless-stopped' }, // Reiniciar automáticamente
        },
        ExposedPorts: {
          [`${internalPort}/tcp`]: {},
        },
      });

      this.logger.log(`Contenedor creado: ${container.id}`);

      // 6. Iniciar el contenedor
      await container.start();
      this.logger.log(`Contenedor iniciado exitosamente`);

      // 7. Configurar Nginx para el subdominio
      await this.nginxService.createProxyConfig(subdomain, hostPort);
      this.logger.log(`Configuración de Nginx creada para ${subdomain}`);

      return {
        success: true,
        url: `https://${subdomain}.boogiepop.cloud`,
        containerId: container.id,
        containerName: existingContainerName,
        hostPort,
        internalPort,
        imageName,
      };
    } catch (error) {
      this.logger.error(`Error durante el despliegue: ${(error as Error).message}`, (error as Error).stack);
      throw new BadRequestException(
        `Error al desplegar el microservicio: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Encuentra un puerto disponible en el rango especificado
   * Verifica los contenedores activos para evitar colisiones de puertos
   */
  private async findAvailablePort(min: number, max: number): Promise<number> {
    try {
      // Obtener todos los contenedores activos
      const containers = await this.docker.listContainers({ all: true });
      
      // Extraer todos los puertos en uso
      const usedPorts = new Set<number>();
      containers.forEach((container) => {
        if (container.Ports) {
          container.Ports.forEach((port) => {
            if (port.PublicPort && port.PublicPort >= min && port.PublicPort <= max) {
              usedPorts.add(port.PublicPort);
            }
          });
        }
      });

      this.logger.debug(`Puertos en uso: ${Array.from(usedPorts).join(', ')}`);

      // Buscar un puerto disponible
      const maxAttempts = 100; // Evitar loops infinitos
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidatePort = Math.floor(Math.random() * (max - min + 1) + min);
        
        if (!usedPorts.has(candidatePort)) {
          this.logger.log(`Puerto disponible encontrado: ${candidatePort}`);
          return candidatePort;
        }
      }

      // Si no encontramos un puerto después de varios intentos, buscar secuencialmente
      this.logger.warn('No se encontró puerto aleatorio disponible, buscando secuencialmente...');
      for (let port = min; port <= max; port++) {
        if (!usedPorts.has(port)) {
          this.logger.log(`Puerto disponible encontrado (búsqueda secuencial): ${port}`);
          return port;
        }
      }

      // Si todos los puertos están ocupados
      throw new BadRequestException(
        `No hay puertos disponibles en el rango ${min}-${max}. Por favor, libera algunos contenedores.`
      );
    } catch (error) {
      // Si hay un error al listar contenedores, usar método aleatorio como fallback
      this.logger.warn(
        `Error al verificar puertos en uso: ${(error as Error).message}. Usando método aleatorio como fallback.`
      );
      return Math.floor(Math.random() * (max - min + 1) + min);
    }
  }

  /**
   * Lista todos los contenedores desplegados
   */
  async listDeployments() {
    try {
      const containers = await this.docker.listContainers({ all: true });
      
      // Filtrar solo los contenedores que empiezan con "container-"
      const deploymentContainers = containers
        .filter((container) => container.Names?.some((name) => name.startsWith('/container-')))
        .map((container) => {
          const name = container.Names?.[0]?.replace('/', '') || 'unknown';
          const subdomain = name.replace('container-', '');
          
          // Extraer el puerto del host
          const portInfo = container.Ports?.[0];
          const hostPort = portInfo?.PublicPort || null;

          return {
            containerId: container.Id,
            containerName: name,
            subdomain,
            image: container.Image,
            status: container.Status,
            hostPort,
            createdAt: container.Created,
          };
        });

      return deploymentContainers;
    } catch (error) {
      this.logger.error(`Error listando despliegues: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Detiene y elimina un despliegue
   */
  async removeDeployment(subdomain: string) {
    this.logger.log(`Eliminando despliegue para subdominio: ${subdomain}`);

    try {
      const containerName = `container-${subdomain}`;
      const container = this.docker.getContainer(containerName);

      // Detener el contenedor si está corriendo
      try {
        const containerInfo = await container.inspect();
        if (containerInfo.State.Running) {
          this.logger.log(`Deteniendo contenedor: ${containerName}`);
          await container.stop();
        }
      } catch (error: any) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }

      // Eliminar el contenedor
      this.logger.log(`Eliminando contenedor: ${containerName}`);
      await container.remove();

      // Eliminar la configuración de Nginx
      await this.nginxService.removeProxyConfig(subdomain);

      return {
        success: true,
        message: `Despliegue eliminado para ${subdomain}.boogiepop.cloud`,
        subdomain: `${subdomain}.boogiepop.cloud`,
      };
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new BadRequestException(`No se encontró un despliegue para el subdominio: ${subdomain}`);
      }
      this.logger.error(`Error eliminando despliegue: ${(error as Error).message}`);
      throw error;
    }
  }
}
