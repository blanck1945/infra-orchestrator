import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsInt, Min, Max, Matches } from 'class-validator';

export class CreateProxyConfigDto {
  @ApiProperty({
    example: 'mi-app',
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
    description: 'El puerto del contenedor al que se hará proxy',
    minimum: 1,
    maximum: 65535,
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  containerPort: number;
}
