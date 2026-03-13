import { z } from "zod";
import {
  COMPANY_OPERATING_MODELS,
  COMPANY_SOCIAL_SIGNAL_SOURCES,
  COMPANY_STATUSES,
} from "../constants.js";

export const companyBlueprintStateSchema = z.object({
  key: z.literal("zero_person_rd"),
  initializedAt: z.string().datetime(),
  initializedByUserId: z.string().nullable(),
  socialChannels: z.array(z.enum(COMPANY_SOCIAL_SIGNAL_SOURCES)).default(["x", "reddit"]),
});

export const companyMetadataSchema = z.object({
  operatingModel: z.enum(COMPANY_OPERATING_MODELS).optional(),
  templateVersion: z.string().optional().nullable(),
  blueprint: companyBlueprintStateSchema.optional().nullable(),
});

export const createCompanySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  metadata: companyMetadataSchema.optional().nullable(),
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema
  .partial()
  .extend({
    status: z.enum(COMPANY_STATUSES).optional(),
    spentMonthlyCents: z.number().int().nonnegative().optional(),
    requireBoardApprovalForNewAgents: z.boolean().optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  });

export type UpdateCompany = z.infer<typeof updateCompanySchema>;

export const zeroPersonRDBlueprintBootstrapSchema = z.object({
  goal: z.string().min(1).optional().nullable(),
  socialChannels: z.array(z.enum(COMPANY_SOCIAL_SIGNAL_SOURCES)).optional().default(["x", "reddit"]),
});

export type ZeroPersonRDBlueprintBootstrap = z.infer<
  typeof zeroPersonRDBlueprintBootstrapSchema
>;
