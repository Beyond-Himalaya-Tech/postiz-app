import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class EngagementSettingsDto {
  @IsBoolean()
  active: boolean;

  @IsBoolean()
  comments: boolean;

  @IsBoolean()
  messages: boolean;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords: string[];

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  brandContext?: string;
}
