import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

export class EngagementDraftDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(5000)
  draft: string;
}
