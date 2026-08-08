// Hand-written database types. Update in the same change as any migration —
// the app must never compile against a schema that no longer exists.

export type ProjectRole = "owner" | "admin" | "operator" | "viewer";

export interface Database {
  public: {
    Tables: {
      allowed_email_domains: {
        Row: { domain: string; added_at: string };
        Insert: { domain: string; added_at?: string };
        Update: { domain?: string; added_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          owner_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          description?: string | null;
          owner_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          project_id: string;
          user_id: string;
          role: ProjectRole;
          added_by: string | null;
          added_at: string;
        };
        Insert: {
          project_id: string;
          user_id: string;
          role?: ProjectRole;
          added_by?: string | null;
          added_at?: string;
        };
        Update: {
          project_id?: string;
          user_id?: string;
          role?: ProjectRole;
          added_by?: string | null;
          added_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      remote_labs: {
        Row: {
          id: string;
          project_id: string;
          slug: string;
          name: string;
          description: string | null;
          lab_url: string | null;
          control_url: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          slug: string;
          name: string;
          description?: string | null;
          lab_url?: string | null;
          control_url?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          slug?: string;
          name?: string;
          description?: string | null;
          lab_url?: string | null;
          control_url?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "remote_labs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_project_admin: { Args: { pid: string }; Returns: boolean };
      is_project_member: { Args: { pid: string }; Returns: boolean };
      lab_heartbeat: {
        Args: { p_slug: string; p_secret: string };
        Returns: boolean;
      };
      set_lab_heartbeat_secret: {
        Args: { p_lab_id: string; p_secret: string };
        Returns: undefined;
      };
    };
    Enums: {
      project_role: ProjectRole;
    };
    CompositeTypes: Record<string, never>;
  };
}
