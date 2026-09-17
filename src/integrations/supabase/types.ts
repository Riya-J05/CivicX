export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      challenge_duplicates: {
        Row: {
          ai_classification: string
          ai_confidence: number | null
          ai_reason: string | null
          ai_recommended_action: string | null
          challenge_id: string
          created_at: string
          distance_m: number | null
          id: string
          possible_duplicate_id: string
          similarity_score: number
          status: string
        }
        Insert: {
          ai_classification?: string
          ai_confidence?: number | null
          ai_reason?: string | null
          ai_recommended_action?: string | null
          challenge_id: string
          created_at?: string
          distance_m?: number | null
          id?: string
          possible_duplicate_id: string
          similarity_score?: number
          status?: string
        }
        Update: {
          ai_classification?: string
          ai_confidence?: number | null
          ai_reason?: string | null
          ai_recommended_action?: string | null
          challenge_id?: string
          created_at?: string
          distance_m?: number | null
          id?: string
          possible_duplicate_id?: string
          similarity_score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_duplicates_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_duplicates_possible_duplicate_id_fkey"
            columns: ["possible_duplicate_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_evidence: {
        Row: {
          challenge_id: string
          created_at: string
          duration_seconds: number | null
          evidence_type: string | null
          file_name: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          uploaded_by: string | null
        }
        Insert: {
          challenge_id: string
          created_at?: string
          duration_seconds?: number | null
          evidence_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          uploaded_by?: string | null
        }
        Update: {
          challenge_id?: string
          created_at?: string
          duration_seconds?: number | null
          evidence_type?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "challenge_evidence_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_status_history: {
        Row: {
          challenge_id: string
          created_at: string
          id: string
          message: string | null
          status: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          id?: string
          message?: string | null
          status: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          id?: string
          message?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_status_history_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          address: string | null
          affected_stakeholders: string[] | null
          ai_confidence: number | null
          ai_summary: string | null
          canonical_challenge_id: string | null
          category: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string
          description: string
          emergency_status: string
          escalated_at: string | null
          estimated_impact: number | null
          id: string
          latitude: number | null
          locality: string | null
          location_name: string | null
          longitude: number | null
          priority: string
          recommended_service: string | null
          recommended_skills: string[] | null
          report_count: number
          solution_directions: string[] | null
          state: string | null
          status: string
          threat_category: string | null
          threat_level: string
          threat_reason: string | null
          title: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          affected_stakeholders?: string[] | null
          ai_confidence?: number | null
          ai_summary?: string | null
          canonical_challenge_id?: string | null
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by: string
          description: string
          emergency_status?: string
          escalated_at?: string | null
          estimated_impact?: number | null
          id?: string
          latitude?: number | null
          locality?: string | null
          location_name?: string | null
          longitude?: number | null
          priority?: string
          recommended_service?: string | null
          recommended_skills?: string[] | null
          report_count?: number
          solution_directions?: string[] | null
          state?: string | null
          status?: string
          threat_category?: string | null
          threat_level?: string
          threat_reason?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          affected_stakeholders?: string[] | null
          ai_confidence?: number | null
          ai_summary?: string | null
          canonical_challenge_id?: string | null
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string
          description?: string
          emergency_status?: string
          escalated_at?: string | null
          estimated_impact?: number | null
          id?: string
          latitude?: number | null
          locality?: string | null
          location_name?: string | null
          longitude?: number | null
          priority?: string
          recommended_service?: string | null
          recommended_skills?: string[] | null
          report_count?: number
          solution_directions?: string[] | null
          state?: string | null
          status?: string
          threat_category?: string | null
          threat_level?: string
          threat_reason?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_canonical_challenge_id_fkey"
            columns: ["canonical_challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_collaborations: {
        Row: {
          challenge_id: string
          created_at: string
          id: string
          industry_user_id: string
          message: string
          next_step: string | null
          proposal_id: string
          status: string
          support_types: string[]
          team_id: string
          updated_at: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          id?: string
          industry_user_id: string
          message?: string
          next_step?: string | null
          proposal_id: string
          status?: string
          support_types?: string[]
          team_id: string
          updated_at?: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          id?: string
          industry_user_id?: string
          message?: string
          next_step?: string | null
          proposal_id?: string
          status?: string
          support_types?: string[]
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "industry_collaborations_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "industry_collaborations_industry_user_id_fkey"
            columns: ["industry_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "industry_collaborations_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "solution_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "industry_collaborations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          academic_disciplines: string[] | null
          bio: string | null
          civic_domains: string[] | null
          course: string | null
          created_at: string
          department: string | null
          district: string | null
          email: string | null
          expertise_areas: string[] | null
          faculty_expertise: string[] | null
          id: string
          industry_domain: string | null
          innovation_facilities: string[] | null
          institution: string | null
          jurisdiction: string | null
          lab_capabilities: string[] | null
          name: string | null
          organization_type: string | null
          research_areas: string[] | null
          role: string
          skills: string[] | null
          support_capabilities: string[] | null
          tech_capabilities: string[] | null
          technologies: string[] | null
          website: string | null
          year: string | null
        }
        Insert: {
          academic_disciplines?: string[] | null
          bio?: string | null
          civic_domains?: string[] | null
          course?: string | null
          created_at?: string
          department?: string | null
          district?: string | null
          email?: string | null
          expertise_areas?: string[] | null
          faculty_expertise?: string[] | null
          id: string
          industry_domain?: string | null
          innovation_facilities?: string[] | null
          institution?: string | null
          jurisdiction?: string | null
          lab_capabilities?: string[] | null
          name?: string | null
          organization_type?: string | null
          research_areas?: string[] | null
          role?: string
          skills?: string[] | null
          support_capabilities?: string[] | null
          tech_capabilities?: string[] | null
          technologies?: string[] | null
          website?: string | null
          year?: string | null
        }
        Update: {
          academic_disciplines?: string[] | null
          bio?: string | null
          civic_domains?: string[] | null
          course?: string | null
          created_at?: string
          department?: string | null
          district?: string | null
          email?: string | null
          expertise_areas?: string[] | null
          faculty_expertise?: string[] | null
          id?: string
          industry_domain?: string | null
          innovation_facilities?: string[] | null
          institution?: string | null
          jurisdiction?: string | null
          lab_capabilities?: string[] | null
          name?: string | null
          organization_type?: string | null
          research_areas?: string[] | null
          role?: string
          skills?: string[] | null
          support_capabilities?: string[] | null
          tech_capabilities?: string[] | null
          technologies?: string[] | null
          website?: string | null
          year?: string | null
        }
        Relationships: []
      }
      proposal_reviews: {
        Row: {
          assessment: string
          created_at: string
          id: string
          impact_potential: string
          implementation_complexity: string
          next_step: string
          proposal_id: string
          recommendations: string[]
          risks: string[]
          skill_alignment: string
          strengths: string[]
          technical_feasibility: string
        }
        Insert: {
          assessment: string
          created_at?: string
          id?: string
          impact_potential: string
          implementation_complexity: string
          next_step: string
          proposal_id: string
          recommendations?: string[]
          risks?: string[]
          skill_alignment: string
          strengths?: string[]
          technical_feasibility: string
        }
        Update: {
          assessment?: string
          created_at?: string
          id?: string
          impact_potential?: string
          implementation_complexity?: string
          next_step?: string
          proposal_id?: string
          recommendations?: string[]
          risks?: string[]
          skill_alignment?: string
          strengths?: string[]
          technical_feasibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_reviews_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "solution_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      solution_proposals: {
        Row: {
          created_at: string
          created_by: string
          estimated_timeline: string
          expected_impact: string
          id: string
          implementation_plan: Json
          mission_id: string
          problem_understanding: string
          proposed_solution: string
          resources_required: string[]
          status: string
          submitted_at: string | null
          team_id: string
          technologies: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          estimated_timeline?: string
          expected_impact?: string
          id?: string
          implementation_plan?: Json
          mission_id: string
          problem_understanding?: string
          proposed_solution?: string
          resources_required?: string[]
          status?: string
          submitted_at?: string | null
          team_id: string
          technologies?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          estimated_timeline?: string
          expected_impact?: string
          id?: string
          implementation_plan?: Json
          mission_id?: string
          problem_understanding?: string
          proposed_solution?: string
          resources_required?: string[]
          status?: string
          submitted_at?: string | null
          team_id?: string
          technologies?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solution_proposals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solution_proposals_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solution_proposals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          contribution_area: string | null
          id: string
          is_leader: boolean
          joined_at: string
          team_id: string
          user_id: string
        }
        Insert: {
          contribution_area?: string | null
          id?: string
          is_leader?: boolean
          joined_at?: string
          team_id: string
          user_id: string
        }
        Update: {
          contribution_area?: string | null
          id?: string
          is_leader?: boolean
          joined_at?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string
          id: string
          mission_id: string
          skill_coverage: number | null
          status: string
          team_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          mission_id: string
          skill_coverage?: number | null
          status?: string
          team_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          mission_id?: string
          skill_coverage?: number | null
          status?: string
          team_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      challenge_has_industry_ready_proposal: {
        Args: { _challenge_id: string }
        Returns: boolean
      }
      find_duplicate_candidates: {
        Args: { _challenge_id: string; _limit?: number; _radius_m?: number }
        Returns: {
          ai_summary: string
          category: string
          city: string
          created_at: string
          description: string
          distance_m: number
          id: string
          latitude: number
          locality: string
          location_name: string
          longitude: number
          priority: string
          report_count: number
          status: string
          title: string
        }[]
      }
      get_canonical_challenge: {
        Args: { _challenge_id: string }
        Returns: {
          ai_summary: string
          category: string
          city: string
          created_at: string
          id: string
          latitude: number
          location_name: string
          longitude: number
          priority: string
          recommended_skills: string[]
          report_count: number
          status: string
          title: string
        }[]
      }
      has_civic_role: {
        Args: { _role: string; _user_id: string }
        Returns: boolean
      }
      is_industry_ready_proposal: {
        Args: { _proposal_id: string }
        Returns: boolean
      }
      is_team_leader: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      is_team_owner: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      set_duplicate_link: {
        Args: { _duplicate_id: string; _linked: boolean }
        Returns: undefined
      }
      team_has_industry_ready_proposal: {
        Args: { _team_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
