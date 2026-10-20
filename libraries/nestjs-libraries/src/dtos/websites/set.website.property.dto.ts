import { IsDefined, IsString } from 'class-validator';

export class SetWebsitePropertyDto {
  @IsString()
  @IsDefined()
  externalId: string;
}
