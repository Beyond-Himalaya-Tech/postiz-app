import { IsOptional, IsString } from 'class-validator';

export class ConnectWebsiteSourceDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  websiteId?: string;

  @IsString()
  @IsOptional()
  apiKey?: string;
}
