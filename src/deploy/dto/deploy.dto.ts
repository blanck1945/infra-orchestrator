import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsInt, Min, Max, Matches } from 'class-validator';

export class DeployDto {
  @ApiProperty({
    example: 'tu-usuario/mi-microservicio',
    description: 'Nombre de la imagen de Docker (puede incluir el tag, ej: usuario/imagen:tag)',
  })
  @IsString()
  @IsNotEmpty()
  imageName: string;

  @ApiProperty({
    example: 'cliente1',
    description: 'El subdominio (sin el dominio base .boogiepop.cloud)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El subdominio solo permite letras minúsculas, números y guiones (-).',
  })
  subdomain: string;

  @ApiProperty({
    example: 3000,
    description: 'El puerto interno donde escucha el microservicio dentro del contenedor',
    minimum: 1,
    maximum: 65535,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  internalPort: number;
}
