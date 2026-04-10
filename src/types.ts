export interface BYTProcedure {
  id: string;
  code: string;
  name: string;
  content: string;
  category?: string;
}

export interface ClinicTechnique {
  id: string;
  code: string;
  name: string;
  department?: string;
}

export interface MatchedResult {
  technique: ClinicTechnique;
  procedure?: BYTProcedure;
}
