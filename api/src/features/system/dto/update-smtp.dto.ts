import { createZodDto } from 'nestjs-zod';
import { createSmtpSchema } from './create-smtp.dto';

export const updateSmtpSchema = createSmtpSchema.partial();

export class UpdateSmtpDto extends createZodDto(updateSmtpSchema) {}
