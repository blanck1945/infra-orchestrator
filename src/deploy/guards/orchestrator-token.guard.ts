import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OrchestratorTokenGuard implements CanActivate {
  private readonly logger = new Logger(OrchestratorTokenGuard.name);

  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    
    // Buscar el header de autorización (puede estar en diferentes casos)
    const authHeader = 
      request.headers.authorization || 
      request.headers.Authorization ||
      request.headers['authorization'] ||
      request.headers['Authorization'];

    if (!authHeader) {
      this.logger.warn('Intento de acceso sin token de autorización');
      throw new UnauthorizedException(
        'Token de autorización requerido. Envía el header: Authorization: Bearer <tu_token>'
      );
    }

    // Extraer el token del header "Authorization: Bearer <token>"
    // Manejar tanto "Bearer token" como solo "token"
    let token = authHeader;
    if (authHeader.startsWith('Bearer ') || authHeader.startsWith('bearer ')) {
      token = authHeader.replace(/^Bearer\s+/i, '');
    }

    if (!token || token.trim() === '') {
      throw new UnauthorizedException(
        'Formato de token inválido. Usa: Authorization: Bearer <tu_token>'
      );
    }

    const validToken = this.configService.get('ORCHESTRATOR_TOKEN');

    if (!validToken) {
      this.logger.error('ORCHESTRATOR_TOKEN no está configurado en el servidor');
      throw new UnauthorizedException(
        'ORCHESTRATOR_TOKEN no está configurado en el servidor. Contacta al administrador.',
      );
    }

    if (token.trim() !== validToken.trim()) {
      this.logger.warn('Intento de acceso con token inválido');
      throw new UnauthorizedException('Token de autorización inválido');
    }

    this.logger.debug('Token de autorización válido');
    return true;
  }
}
