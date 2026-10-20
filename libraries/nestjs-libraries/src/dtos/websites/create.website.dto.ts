import { IsDefined, IsFQDN, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWebsiteDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsDefined()
  @IsFQDN()
  domain: string;
}
