import type {
  CompanyOperatingModel,
  CompanySocialSignalSource,
  CompanyStatus,
} from "../constants.js";

export interface CompanyBlueprintState {
  key: "zero_person_rd";
  initializedAt: string;
  initializedByUserId: string | null;
  socialChannels: CompanySocialSignalSource[];
}

export interface CompanyMetadata {
  operatingModel?: CompanyOperatingModel;
  templateVersion?: string | null;
  blueprint?: CompanyBlueprintState | null;
}

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApprovalForNewAgents: boolean;
  brandColor: string | null;
  metadata: CompanyMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ZeroPersonRDBlueprintBootstrapRequest {
  goal?: string | null;
  socialChannels?: CompanySocialSignalSource[];
}

export interface ZeroPersonRDBlueprintBootstrapResult {
  company: Company;
  goalId: string;
  createdAgentIds: string[];
  createdProjectIds: string[];
  createdIssueIds: string[];
}
