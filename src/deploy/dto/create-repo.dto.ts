import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, IsBoolean, IsOptional } from 'class-validator';

export class CreateRepoDto {
  @ApiProperty({
    example: 'mi-microservicio',
    description: 'Nombre del repositorio a crear en GitHub',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El nombre del repositorio solo permite letras minúsculas, números y guiones (-).',
  })
  name: string;

  @ApiProperty({
    example: 'cliente1',
    description: 'El subdominio que se usará para el despliegue (sin el dominio base .boogiepop.cloud)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El subdominio solo permite letras minúsculas, números y guiones (-).',
  })
  subdomain: string;

  @ApiProperty({
    example: false,
    description: 'Si el repositorio debe ser privado (true) o público (false). Por defecto es público (false)',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  private?: boolean;
}
