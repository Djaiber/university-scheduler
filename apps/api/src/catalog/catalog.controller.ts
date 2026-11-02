import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { DatabaseService } from '../database/database.service';

interface PeriodBody { code: string; starts_on: string; ends_on: string }
interface ProgramBody { code: string; name: string; faculty: string }

const periodSchema = {
  type: 'object', additionalProperties: false, required: ['code', 'starts_on', 'ends_on'],
  properties: { code: { type: 'string', pattern: '^[0-9]{4}-[12]$' }, starts_on: { type: 'string', format: 'date' }, ends_on: { type: 'string', format: 'date' } },
};
const programSchema = {
  type: 'object', additionalProperties: false, required: ['code', 'name', 'faculty'],
  properties: { code: { type: 'string', minLength: 2 }, name: { type: 'string', minLength: 3 }, faculty: { type: 'string', minLength: 3 } },
};

/** Catálogos mínimos que no llegan por CSV: períodos académicos y programas. */
@Controller()
export class CatalogController {
  constructor(private readonly db: DatabaseService) {}

  @Get('academic-periods')
  periods() {
    return this.db.query('SELECT id, code, starts_on, ends_on FROM academic_periods ORDER BY code DESC');
  }

  @Post('academic-periods')
  @Roles('DATA_STEWARD')
  async createPeriod(@Body(new SchemaValidationPipe<PeriodBody>(periodSchema)) b: PeriodBody) {
    const [row] = await this.db.query(
      'INSERT INTO academic_periods(code, starts_on, ends_on) VALUES ($1, $2, $3) RETURNING id, code, starts_on, ends_on',
      [b.code, b.starts_on, b.ends_on],
    );
    return row;
  }

  @Get('programs')
  programs() {
    return this.db.query('SELECT id, code, name, faculty FROM programs ORDER BY code');
  }

  @Post('programs')
  @Roles('DATA_STEWARD')
  async createProgram(@Body(new SchemaValidationPipe<ProgramBody>(programSchema)) b: ProgramBody) {
    const [row] = await this.db.query(
      'INSERT INTO programs(code, name, faculty) VALUES ($1, $2, $3) RETURNING id, code, name, faculty',
      [b.code, b.name, b.faculty],
    );
    return row;
  }
}
