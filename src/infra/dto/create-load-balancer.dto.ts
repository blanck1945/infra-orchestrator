import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateLoadBalancerDto {
  @ApiProperty({
    example: 'host-platform',
    description: 'Nombre de la infraestructura existente (debe coincidir con el name usado al crear VPC/EC2)',
  })
  @IsString()
  @IsNotEmpty({ message: 'name es requerido' })
  @MaxLength(32)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El nombre solo permite minúsculas, números y guiones.',
  })
  name: string;

  @ApiProperty({
    example: 80,
    description: 'Puerto del listener HTTP. Por defecto 80.',
    required: false,
    default: 80,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  httpPort?: number;

  @ApiProperty({
    example: 443,
    description: 'Puerto del listener HTTPS. Opcional.',
    required: false,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  httpsPort?: number;

  @ApiProperty({
    example: 3000,
    description: 'Puerto del target (puerto donde escucha la aplicación en EC2). Por defecto 3000.',
    required: false,
    default: 3000,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  targetPort?: number;

  @ApiProperty({
    example: 'application',
    description: 'Tipo de load balancer: "application" (ALB) o "network" (NLB). Por defecto "application".',
    required: false,
    default: 'application',
    enum: ['application', 'network'],
  })
  @IsString()
  @IsOptional()
  @Matches(/^(application|network)$/, {
    message: 'El tipo debe ser "application" o "network".',
  })
  loadBalancerType?: string;
}
