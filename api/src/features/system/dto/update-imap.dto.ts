import { createZodDto } from 'nestjs-zod';
import { createImapSchema } from './create-imap.dto';

export const updateImapSchema = createImapSchema.partial();

export class UpdateImapDto extends createZodDto(updateImapSchema) {}
