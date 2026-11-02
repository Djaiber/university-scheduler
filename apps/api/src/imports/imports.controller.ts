import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators';
import { Actor } from '../common/actor.decorator';
import { ImportsService } from './imports.service';
import { ENTITIES } from './templates';

const MAX_BYTES = 5 * 1024 * 1024;

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** Orden recomendado: time_slots → teachers → classrooms → courses → groups → *_availability */
  @Get('templates')
  templates() {
    return { entities: ENTITIES, dictionary: 'data/templates/DICCIONARIO.md' };
  }

  @Post(':entity')
  @Roles('DATA_STEWARD')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @Param('entity') entity: string,
    @Query('period') period: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Actor() actor: string,
  ) {
    if (!period) throw new BadRequestException('El parámetro period es obligatorio (p. ej. ?period=2027-1)');
    if (!file) throw new BadRequestException('Adjunte el CSV en el campo multipart "file"');
    if (!/\.csv$/i.test(file.originalname)) throw new BadRequestException('Solo se aceptan archivos .csv');
    return this.imports.import(entity, period, file, actor);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.imports.get(id);
  }
}
