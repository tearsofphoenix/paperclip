import type { CompanyOperatingModel } from "../constants.js";

export interface ZeroPersonRDFunnelSummary {
  operatingModel: CompanyOperatingModel;
  discover: number;
  validate: number;
  build: number;
  launch: number;
  growth: number;
  shipped: number;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  socialSignals?: {
    new: number;
    reviewing: number;
    validated: number;
    rejected: number;
    promoted: number;
  } | null;
  funnel?: ZeroPersonRDFunnelSummary | null;
}
