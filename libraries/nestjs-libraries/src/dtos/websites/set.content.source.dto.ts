import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SetContentSourceDto {
  @IsString()
  @IsIn(['github'])
  providerIdentifier: string;

  @IsString()
  @IsDefined()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  owner: string;

  @IsString()
  @IsDefined()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  repo: string;

  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(200)
  branch: string;

  // Required, so files outside the blog folder (README, docs) are never listed or changed
  @IsString()
  @IsDefined()
  @Matches(/^[A-Za-z0-9_.\/-]*[A-Za-z0-9_-][A-Za-z0-9_.\/-]*$/)
  @MaxLength(300)
  contentPath: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  urlPrefix: string;

  @IsString()
  @IsDefined()
  @MinLength(10)
  token: string;
}
