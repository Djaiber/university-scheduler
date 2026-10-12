import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, useDefaults: true, removeAdditional: false });
addFormats(ajv);

/** Valida el cuerpo con JSON Schema (misma tecnología que los contratos en data/schemas). */
@Injectable()
export class SchemaValidationPipe<T> implements PipeTransform<unknown, T> {
  private readonly validate: ValidateFunction;

  constructor(schema: object) {
    this.validate = ajv.compile(schema);
  }

  transform(value: unknown): T {
    if (!this.validate(value)) {
      throw new BadRequestException({
        message: 'El cuerpo no cumple el esquema',
        details: (this.validate.errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message })),
      });
    }
    return value as T;
  }
}
