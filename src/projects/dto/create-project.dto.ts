import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, IsBoolean, IsOptional, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'mi-app-react', description: 'Nombre único (solo minúsculas, números, guiones y guiones bajos)' })
  @IsString() @IsNotEmpty() @MinLength(3) @MaxLength(30)
  @Matches(/^[a-z0-9_-]+$/, { message: 'El nombre solo permite minúsculas, números, guiones (-) y guiones bajos (_).' })
  projectName: string;

  @ApiProperty({ example: 'Proyecto creado desde mi interfaz custom', required: false })
  @IsString() @IsOptional() @MaxLength(100)
  description?: string;

  @ApiProperty({ example: true, default: false })
  @IsBoolean() @IsOptional()
  createS3: boolean;
}
