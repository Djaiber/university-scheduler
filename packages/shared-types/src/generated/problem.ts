/* Generado desde data/schemas/problem.v1.json. No editar a mano: npm run generate */

/**
 * Entrada canónica del solver y del validador. Los identificadores son códigos estables.
 */
export interface ProblemaDeHorariosV1 {
  schema_version: '1.0';
  problem_id: string;
  period: string;
  /**
   * @minItems 1
   */
  slots: [
    {
      id: string;
      day: number;
      /**
       * orden de la franja dentro del día
       */
      index: number;
      edge?: boolean;
    },
    ...{
      id: string;
      day: number;
      /**
       * orden de la franja dentro del día
       */
      index: number;
      edge?: boolean;
    }[]
  ];
  teachers: {
    id: string;
    unavailable?: string[];
    not_preferred?: string[];
  }[];
  /**
   * @minItems 1
   */
  rooms: [
    {
      id: string;
      capacity: number;
      features?: string[];
      unavailable?: string[];
    },
    ...{
      id: string;
      capacity: number;
      features?: string[];
      unavailable?: string[];
    }[]
  ];
  /**
   * @minItems 1
   */
  groups: [
    {
      id: string;
      course: string;
      teacher: string;
      cohort: string;
      size: number;
      sessions: number;
      features?: string[];
    },
    ...{
      id: string;
      course: string;
      teacher: string;
      cohort: string;
      size: number;
      sessions: number;
      features?: string[];
    }[]
  ];
  rules: Rules;
}
export interface Rules {
  version: number;
  /**
   * Reglas duras opcionales; las demás H1–H8 siempre aplican
   */
  hard?: {
    H9_SAME_COURSE_SAME_DAY?: boolean;
  };
  soft_weights?: {
    S1_TEACHER_PREFERENCE?: number;
    S2_EDGE_SLOT?: number;
    S3_ROOM_WASTE?: number;
    S4_COHORT_DAY_LOAD?: number;
  };
  max_daily_sessions_per_cohort?: number;
}
