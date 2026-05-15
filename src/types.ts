export type Role = 'Viewer' | 'Room Data Editor' | 'System Owner' | 'Approver' | 'Admin';

export type AttributeType =
  | 'text'
  | 'boolean'
  | 'number'
  | 'date'
  | 'select'
  | 'multi-select'
  | 'tag'
  | 'url'
  | 'system reference';

export type WorkflowStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Awaiting Information'
  | 'Approved'
  | 'Rejected'
  | 'Ready for Implementation'
  | 'Implemented'
  | 'Verified'
  | 'Closed';

export type TaskStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'Completed' | 'Verified';

export interface Campus {
  code: string;
  name: string;
  address?: string;
}

export interface Building {
  code: string;
  name: string;
  campusCode: string;
  owner: string;
}

export interface RoomCategory {
  id: string;
  name: string;
  description: string;
  isTeaching: boolean;
  isBookable: boolean;
  isSpecialist: boolean;
  risk: 'standard' | 'high';
}

export interface RoomPattern {
  id: string;
  name: string;
  category: string;
  description: string;
  ecuAvPatterns: string[];
  vizcomAvPatterns: string[];
  defaultBookingRules: string[];
  defaultO365Config: string[];
  timetablingEligible: boolean;
  accessLogic: string[];
  requiredAttributes: string[];
  approvalRequirements: Role[];
  downstreamSystems: string[];
}

export interface AttributeDefinition {
  key: string;
  label: string;
  description?: string;
  sourceField?: string;
  type: AttributeType;
  group: string;
  required: boolean;
  visible: boolean;
  downstreamSystems: string[];
  options?: string[];
}

export interface Room {
  id: string;
  roomCode: string;
  name: string;
  campus: string;
  building: string;
  floor: string;
  type: string;
  category: string;
  pattern: string;
  capacity: number;
  owner: string;
  bookingStatus: string;
  isTeaching: boolean;
  isBookable: boolean;
  isStudentAccessible: boolean;
  isStaffOnly: boolean;
  isSpecialist: boolean;
  isArchived: boolean;
  physicalNotes: string;
  bookingNotes: string;
  floorplanImageUrl?: string;
  capabilities: string[];
  attributes: Record<string, string | number | boolean | string[]>;
  downstreamSystems: string[];
  qualityFlags: string[];
}

export interface SystemMapping {
  roomId: string;
  systemCode: string;
  systemName: string;
  externalId: string;
  status: 'Mapped' | 'Needs Review' | 'Not Connected';
  lastVerified: string;
}

export interface TransformationRule {
  id: string;
  name: string;
  description: string;
  condition: string;
  outputs: string[];
  systems: string[];
  risk: 'standard' | 'high';
  active: boolean;
}

export interface ImplementationTask {
  id: string;
  title: string;
  system: string;
  ownerTeam: string;
  dueDate: string;
  status: TaskStatus;
  dependency?: string;
  notes?: string;
}

export interface ChangeRequest {
  id: string;
  roomId?: string;
  title: string;
  requestType: string;
  status: WorkflowStatus;
  requestedBy: string;
  reason: string;
  impactedSystems: string[];
  risk: 'standard' | 'high';
  approvers: { role: Role; decision: 'Pending' | 'Approved' | 'Rejected'; comments?: string }[];
  tasks: ImplementationTask[];
  history: string[];
}

export interface ImportPreviewRow {
  id: number;
  source: Record<string, string>;
  action: 'create' | 'update' | 'error';
  issues: string[];
}
