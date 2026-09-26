/** Raw Brightspace shapes used by gryphOS (fields we actually read). */

export interface RawVersion {
  ProductCode: string;
  LatestVersion: string;
}

export interface RawCourse {
  OrgUnitId: string;
  Name: string;
  Code: string | null;
  IsActive?: boolean;
  CanAccessCourse?: boolean;
  StartDate: string | null;
  EndDate: string | null;
  SemesterName?: string | null;
}

export interface RawWhoAmI {
  Identifier: string;
  FirstName: string;
  LastName: string;
  UniqueName: string | null;
}

export interface RawCoursePage {
  Courses: RawCourse[];
  Bookmark: string | null;
}

export interface ObjectListPage<T> {
  Objects: T[];
  Next: string | null;
}

export interface RawFolder {
  Id: number;
  Name: string;
  DueDate: string | null;
  IsHidden?: boolean;
  GradeItemId?: number | null;
  Availability?: { StartDate: string | null; EndDate: string | null } | null;
}

export interface RawQuiz {
  QuizId: number;
  Name: string;
  DueDate: string | null;
  EndDate: string | null;
  IsActive?: boolean;
  GradeItemId?: number | null;
}

export interface RawEntityDropbox {
  Submissions?: { Id: number; SubmissionDate: string | null }[];
}

export interface RawGradeObject {
  Id: number;
  Name: string;
  ShortName?: string | null;
  GradeType?: string | null;
  MaxPoints?: number | null;
  Weight?: number | null;
  IsBonus?: boolean;
  AssociatedTool?: { ToolId: number; ToolItemId: number } | null;
}

export interface RawGradeValue {
  GradeObjectIdentifier: string | number;
  PointsNumerator: number | null;
  PointsDenominator: number | null;
  DisplayedGrade: string | null;
}

export interface RawNewsItem {
  Id: number;
  Title: string;
  Body?: { Text?: string | null; Html?: string | null } | null;
  StartDate: string | null;
  IsHidden?: boolean;
}

export interface RawCalendarEvent {
  CalendarEventId?: number;
  Id?: number;
  Title: string;
  Description?: string | null;
  StartDateTime: string | null;
  EndDateTime: string | null;
  IsAllDayEvent?: boolean;
  OrgUnitId?: number;
}
