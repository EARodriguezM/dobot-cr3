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
          /** NULL = unclaimed; assigned once the owner has a profile (0007). */
          owner_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          description?: string | null;
          owner_id?: string | null;
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
          emoji: string;
          in_development: boolean;
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
          emoji?: string;
          in_development?: boolean;
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
          emoji?: string;
          in_development?: boolean;
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
      research_lines: {
        Row: {
          id: string;
          slug: string;
          number: string;
          icon: string;
          title: string;
          description: string;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          number?: string;
          icon?: string;
          title: string;
          description?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          number?: string;
          icon?: string;
          title?: string;
          description?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      members: {
        Row: {
          id: string;
          slug: string;
          initials: string;
          role_label: string;
          full_name: string;
          focus: string;
          project_slug: string | null;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          initials?: string;
          role_label?: string;
          full_name: string;
          focus?: string;
          project_slug?: string | null;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          initials?: string;
          role_label?: string;
          full_name?: string;
          focus?: string;
          project_slug?: string | null;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      research_path: {
        Row: {
          id: string;
          year: string;
          title: string;
          description: string;
          milestone_kind: string;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          year?: string;
          title: string;
          description?: string;
          milestone_kind?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          year?: string;
          title?: string;
          description?: string;
          milestone_kind?: string;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      content_editors: {
        Row: { user_id: string; added_at: string };
        Insert: { user_id: string; added_at?: string };
        Update: { user_id?: string; added_at?: string };
        Relationships: [];
      };
      platform_admins: {
        Row: { user_id: string; added_at: string };
        Insert: { user_id: string; added_at?: string };
        Update: { user_id?: string; added_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_content_editor: { Args: Record<string, never>; Returns: boolean };
      is_platform_admin: { Args: Record<string, never>; Returns: boolean };
      set_project_owner: {
        Args: { p_project_id: string; p_user_id: string | null };
        Returns: boolean;
      };
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
