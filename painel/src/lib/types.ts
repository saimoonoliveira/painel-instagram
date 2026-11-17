export interface IgAccount {
  id: string;
  ig_user_id: string;
  page_id: string;
  username: string | null;
  display_name: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  connected_at: string | null;
}

export interface Contact {
  id: string;
  ig_account_id: string;
  igsid: string;
  username: string | null;
  full_name: string | null;
  last_interaction_at: string;
  messaging_window_until: string | null;
  created_at: string;
}

export interface Tag {
  id: string;
  ig_account_id: string;
  name: string;
  color: string | null;
}

export interface FlowButton {
  title: string;
  url: string;
}

export interface FlowStep {
  type: "text" | "buttons";
  text: string;
  buttons?: FlowButton[];
}

export interface Flow {
  id: string;
  ig_account_id: string;
  name: string;
  steps: FlowStep[];
  apply_tag_id: string | null;
  is_active: boolean;
  require_follow?: boolean;
  gate_text?: string | null;
  gate_button_label?: string | null;
  not_following_text?: string | null;
}

export type TriggerSource = "comment" | "dm";
export type MatchType = "exact" | "contains" | "word" | "any";

export interface Trigger {
  id: string;
  ig_account_id: string;
  flow_id: string;
  source: TriggerSource;
  match_type: MatchType;
  keyword: string | null;
  media_id: string | null;
  public_reply: string | null;
  priority: number;
  is_active: boolean;
}

export interface Message {
  id: string;
  ig_account_id: string;
  contact_id: string | null;
  direction: "in" | "out";
  channel: "dm" | "comment" | "private_reply";
  text: string | null;
  created_at: string;
}

export type PostStatus = "aguardando" | "ajustes" | "aprovado" | "agendado" | "postado";

// Carrossel produzido para a conta. Cada slide tem a prévia leve (jpg) e o original (png) no bucket "posts".
export interface Post {
  id: string;
  ig_account_id: string;
  titulo: string;
  legenda: string | null;
  legenda_curta: string | null;
  fontes: string | null;
  // ig: JPEG em alta para publicar pelo app (a Meta só aceita JPEG)
  slides: { jpg: string; png: string; ig?: string }[];
  status: PostStatus;
  agendado_para: string | null;
  postado_em: string | null;
  link: string | null;
  notas: string | null;
  ig_media_id: string | null;
  publicando_em: string | null;
  erro_publicacao: string | null;
  criado_em: string;
  atualizado_em: string;
}
