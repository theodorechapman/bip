/**
 * Shared types for scenario content generation and social posting.
 */

export type ProductContent = {
  name: string;
  description: string;
  tags: string[];
  imageBase64?: string;
  imageUrl?: string;
  socialPost: {
    text: string;
    hashtags: string[];
  };
};

export type XAccountConfig = {
  handle: string;
  email: string;
  profileName: string;
  bio?: string;
  setupComplete: boolean;
  createdAt: number;
};

export type SocialPost = {
  text: string;
  hashtags: string[];
  imageBase64?: string;
  platform: "x" | "instagram";
};

export type ImageStyle = "product_photo" | "lifestyle" | "social_post";

export type GenerateImageInput = {
  productName: string;
  productDescription: string;
  style: ImageStyle;
  textOverlay?: string;
};

export type GenerateImageResult = {
  ok: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
};

export type GenerateCopyInput = {
  productName: string;
  productCategory: string;
  supplierDescription: string;
  targetAudience?: string;
};

export type GenerateCopyResult = {
  title: string;
  description: string;
  tags: string[];
};

export type GenerateSocialPostInput = {
  productName: string;
  productDescription: string;
  platform: "x" | "instagram";
  tone?: string;
};

export type GenerateSocialPostResult = {
  text: string;
  hashtags: string[];
};
