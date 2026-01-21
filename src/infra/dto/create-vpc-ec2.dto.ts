import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVpcEc2Dto {
  @ApiProperty({
    example: 'mi-key-pair',
    description: 'Nombre del Key Pair de AWS (debe existir en tu cuenta). Necesario para SSH.',
  })
  @IsString()
  @IsNotEmpty({ message: 'keyName es requerido' })
  @MinLength(1)
  @MaxLength(255)
  keyName: string;

  @ApiProperty({
    example: 'host-platform',
    description: 'Prefijo para nombres de recursos y tags. Opcional.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El nombre solo permite minúsculas, números y guiones.',
  })
  name?: string;

  @ApiProperty({
    example: 't3.micro',
    description: 'Tipo de instancia EC2. Por defecto t3.micro (free tier).',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  instanceType?: string;
}
