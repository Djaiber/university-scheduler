import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { Actor } from '../common/actor.decorator';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { GovernanceService } from './governance.service';

interface ReviewBody { decision: 'SEND_TO_APPROVAL' | 'REQUEST_CHANGES'; comment?: string }
interface ExceptionBody { rule_code: string; justification: string; expires_on: string }

const reviewSchema = {
  type: 'object', additionalProperties: false, required: ['decision'],
  properties: { decision: { enum: ['SEND_TO_APPROVAL', 'REQUEST_CHANGES'] }, comment: { type: 'string', maxLength: 1000 } },
  if: { properties: { decision: { const: 'REQUEST_CHANGES' } } },
  then: { required: ['decision', 'comment'], properties: { comment: { minLength: 5 } } },
};
const approvalSchema = { type: 'object', additionalProperties: false, properties: { comment: { type: 'string', maxLength: 1000 } } };
const exceptionSchema = {
  type: 'object', additionalProperties: false, required: ['rule_code', 'justification', 'expires_on'],
  properties: {
    rule_code: { type: 'string', pattern: '^H[1-9]_[A-Z_]+$' },
    justification: { type: 'string', minLength: 20, maxLength: 2000 },
    expires_on: { type: 'string', format: 'date' },
  },
};

@Controller()
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Post('revisions/:id/reviews')
  @Roles('REVIEWER', 'COORDINATOR')
  review(@Param('id', new ParseUUIDPipe()) id: string, @Body(new SchemaValidationPipe<ReviewBody>(reviewSchema)) b: ReviewBody, @Actor() actor: string) {
    return this.governance.review(id, b.decision, b.comment, actor);
  }

  @Post('revisions/:id/exceptions')
  @Roles('APPROVER')
  exception(@Param('id', new ParseUUIDPipe()) id: string, @Body(new SchemaValidationPipe<ExceptionBody>(exceptionSchema)) b: ExceptionBody, @Actor() actor: string) {
    return this.governance.addException(id, b, actor);
  }

  @Post('revisions/:id/approvals')
  @Roles('APPROVER')
  approve(@Param('id', new ParseUUIDPipe()) id: string, @Body(new SchemaValidationPipe<{ comment?: string }>(approvalSchema)) b: { comment?: string }, @Actor() actor: string) {
    return this.governance.approve(id, b.comment, actor);
  }

  @Post('approvals/:id/publish')
  @Roles('PUBLISHER')
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Actor() actor: string) {
    return this.governance.publish(id, actor);
  }

  @Get('schedule-requests/:id/governance')
  summary(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.governance.summary(id);
  }

  @Get('audit')
  @Roles('REVIEWER', 'APPROVER', 'COORDINATOR')
  audit(@Query('entity_type') entityType?: string, @Query('entity_id') entityId?: string, @Query('limit') limit?: string) {
    return this.governance.auditTrail(entityType, entityId, limit ? Number(limit) : 200);
  }
}
