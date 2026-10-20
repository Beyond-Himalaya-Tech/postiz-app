import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateWebsiteContentDto {
  @IsString()
  @IsIn(['new_article', 'update_article'])
  type: 'new_article' | 'update_article';

  @IsString()
  @MaxLength(300)
  title: string;

  @IsString()
  @MaxLength(2000)
  reason: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  targetQueries: string[];

  @IsString()
  @IsOptional()
  @MaxLength(500)
  filePath?: string;
}
