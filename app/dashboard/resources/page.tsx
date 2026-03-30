"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, ChevronDown, ExternalLink, MapPin, Search, X } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";

// ─── Types ────────────────────────────────────────────────────────────────────

type GradeTag = "All Ages" | "K–2" | "3–5" | "6–8" | "9–12";
type RegLevel = "none" | "low" | "moderate" | "high";

type DbResource = {
  id: string; category: string; title: string; description: string;
  url: string; grade_level: string; badge_text: string;
  metadata: Record<string, unknown>;
  is_free_pick?: boolean;
  created_at?: string;
};
type EasyWin = { emoji: string; title: string; desc: string; time: string; grade: string; url?: string; };

// ─── State Requirements (all 50 states) ──────────────────────────────────────

const LEVEL_LABELS: Record<RegLevel, { label: string; color: string; bg: string }> = {
  none:     { label: "No notice required", color: "#2d5c38", bg: "#e4f0e6" },
  low:      { label: "Low regulation",     color: "#5c6420", bg: "#f0f4d8" },
  moderate: { label: "Moderate",           color: "#7a5020", bg: "#f5e8d8" },
  high:     { label: "High regulation",    color: "#7a2020", bg: "#f5e0e0" },
};

const STATE_REQS: Record<string, { level: RegLevel; summary: string }> = {
  "Alabama":        { level: "low",      summary: "File a church school notice with the local church school. Teach required subjects. No testing required." },
  "Alaska":         { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Arizona":        { level: "low",      summary: "File affidavit with county school superintendent annually. Must teach required subjects." },
  "Arkansas":       { level: "moderate", summary: "File notice of intent with local superintendent. Annual standardized testing required in grades 5, 7, 10." },
  "California":     { level: "low",      summary: "File Private School Affidavit annually. Required subjects: English, math, social science, science, art, music, PE, health." },
  "Colorado":       { level: "low",      summary: "File notice of intent with local school district. Annual assessment required." },
  "Connecticut":    { level: "none",     summary: "No notice required. Must provide instruction in equivalent subjects to public school." },
  "Delaware":       { level: "moderate", summary: "File with local school district. 180 days required. Must follow state curriculum guidelines." },
  "Florida":        { level: "low",      summary: "File notice with county superintendent. Annual evaluation by a Florida-certified teacher or standardized test." },
  "Georgia":        { level: "low",      summary: "File Declaration of Intent with local school superintendent. Keep annual attendance records." },
  "Hawaii":         { level: "moderate", summary: "Register with Department of Education. Submit curriculum. Annual assessment required." },
  "Idaho":          { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Illinois":       { level: "none",     summary: "No notice required. Must provide instruction in state subjects." },
  "Indiana":        { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Iowa":           { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Kansas":         { level: "none",     summary: "No notice required. Must teach required subjects in English." },
  "Kentucky":       { level: "low",      summary: "Notify local superintendent. Attend 185 days per year. Keep attendance records." },
  "Louisiana":      { level: "low",      summary: "Submit letter of intent to local school board. Teach required subjects." },
  "Maine":          { level: "moderate", summary: "File annual approval with local superintendent. Submit curriculum and annual assessment plan." },
  "Maryland":       { level: "moderate", summary: "File notification with local superintendent. Annual portfolio review or standardized test." },
  "Massachusetts":  { level: "high",     summary: "Get annual approval from local school committee. Submit curriculum. Must demonstrate instruction in required subjects and hours." },
  "Michigan":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Minnesota":      { level: "moderate", summary: "File annual assessment report with local district. Required subjects must be taught." },
  "Mississippi":    { level: "low",      summary: "File notice of intent with local superintendent. Attend 180 days per year." },
  "Missouri":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Montana":        { level: "low",      summary: "File notice with county superintendent. Teach required subjects 180 days per year." },
  "Nebraska":       { level: "moderate", summary: "Notify superintendent. Provide equivalent instruction in required subjects. Record-keeping recommended." },
  "Nevada":         { level: "low",      summary: "File notification with school district. Teach required subjects, 180 school days." },
  "New Hampshire":  { level: "moderate", summary: "File annual notice. Annual assessment or portfolio review required." },
  "New Jersey":     { level: "none",     summary: "No notice required. Must cover required subjects." },
  "New Mexico":     { level: "low",      summary: "File with public school district. Must teach required subjects." },
  "New York":       { level: "high",     summary: "Submit Individualized Home Instruction Plan (IHIP). Quarterly reports and annual assessments required." },
  "North Carolina": { level: "moderate", summary: "File notice of intent. Maintain attendance records. Annual standardized test required." },
  "North Dakota":   { level: "high",     summary: "Parent must have a teaching certificate, or use an accredited correspondence program, or pass a teacher competency test." },
  "Ohio":           { level: "moderate", summary: "File notice with local superintendent. Required subjects must be taught. Annual assessment." },
  "Oklahoma":       { level: "none",     summary: "No notice required. No testing or assessment required." },
  "Oregon":         { level: "moderate", summary: "File notice with ESD. Annual assessment for students in grades 3, 5, 8, and 10." },
  "Pennsylvania":   { level: "high",     summary: "File annual affidavit. 180 days instruction. Portfolio review by a licensed supervisor or notarized test results." },
  "Rhode Island":   { level: "moderate", summary: "File notice and curriculum with local school committee. Annual approval required." },
  "South Carolina": { level: "moderate", summary: "Choose from 3 accountability options. Most require membership in an approved home school association." },
  "South Dakota":   { level: "low",      summary: "File annual notice of intent with local superintendent." },
  "Tennessee":      { level: "low",      summary: "File notice with local superintendent. Annual assessment required. Parent must have high school diploma." },
  "Texas":          { level: "none",     summary: "No notice required. Instruction must include required subjects in a bona fide manner." },
  "Utah":           { level: "low",      summary: "File an affidavit with the local school board. Teach required subjects." },
  "Vermont":        { level: "high",     summary: "Enroll with state. Annual assessment. Must cover specific subjects and hours." },
  "Virginia":       { level: "moderate", summary: "File notice of intent with division superintendent. Annual assessment or portfolio review required." },
  "Washington":     { level: "moderate", summary: "File annual Declaration of Intent. Annual assessment required in grades 4, 8, and 11." },
  "West Virginia":  { level: "high",     summary: "Notify county superintendent. Annual assessment. Parent must hold a high school diploma or higher." },
  "Wisconsin":      { level: "none",     summary: "No notice required. Must provide equivalent instruction in required subjects." },
  "Wyoming":        { level: "low",      summary: "Notify local board of trustees. Teach required subjects 175 days per year." },
};

// ─── Rich State Info ───────────────────────────────────────────────────────────

type RegBadge = "Low" | "Medium" | "High";
type StateInfo = {
  regulation: RegBadge; notice: string; requiredSubjects: string[];
  attendance: string; testing: string; portfolios: string;
  hsldaUrl: string; localGroupUrl: string;
};

const REG_BADGE: Record<RegBadge, { color: string; bg: string }> = {
  Low:    { color: "#2d5c38", bg: "#d4ead8" },
  Medium: { color: "#7a5020", bg: "#f5e8d8" },
  High:   { color: "#7a2020", bg: "#f5e0e0" },
};

const STATE_INFO: Record<string, StateInfo> = {
  "Alabama":        { regulation: "Low",    notice: "File a church school covering notice annually", requiredSubjects: ["Reading","Language Arts","Math","Science","Social Studies","Health","Alabama History"], attendance: "140 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/alabama", localGroupUrl: "https://www.chef.org" },
  "Alaska":         { regulation: "Low",    notice: "Register with local school district or file as home school", requiredSubjects: ["Language Arts","Math","Science","Social Studies"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/alaska", localGroupUrl: "https://www.alaskahomedpa.org" },
  "Arizona":        { regulation: "Low",    notice: "File affidavit with county school superintendent by Oct 1", requiredSubjects: ["Reading","Grammar","Math","Social Studies","Science","Health"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/arizona", localGroupUrl: "https://azhomeschool.org" },
  "Arkansas":       { regulation: "Medium", notice: "File notice of intent with local superintendent", requiredSubjects: ["Reading","Language Arts","Math","Social Studies","Science","Health"], attendance: "175 days/year", testing: "Annual standardized test in grades 5, 7, and 10", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/arkansas", localGroupUrl: "https://www.arkansashomeschool.org" },
  "California":     { regulation: "Low",    notice: "File Private School Affidavit (PSA) annually Oct 1–15", requiredSubjects: ["English","Math","Social Science","Science","Visual/Performing Arts","Music","PE","Health"], attendance: "175 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/california", localGroupUrl: "https://californiahomeschool.net" },
  "Colorado":       { regulation: "Low",    notice: "File notice with local school district by Aug 1", requiredSubjects: ["Communication Skills","Reading","Writing","Math","History","Geography","Civics","Science","Health","PE"], attendance: "None specified", testing: "Annual assessment required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/colorado", localGroupUrl: "https://www.cche.net" },
  "Connecticut":    { regulation: "Low",    notice: "No formal notice required; local boards may request it", requiredSubjects: ["Reading","Writing","Spelling","English","Math","Geography","History","Science","Health","Art","Music","PE"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/connecticut", localGroupUrl: "https://www.leah.org" },
  "Delaware":       { regulation: "Medium", notice: "File with local school district", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/delaware", localGroupUrl: "https://www.dehe.net" },
  "Florida":        { regulation: "Low",    notice: "File notice with county school superintendent by Aug 1", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","Art","Music"], attendance: "180 days/year", testing: "Annual evaluation by FL-certified teacher OR standardized test", portfolios: "Portfolio required for annual evaluation option", hsldaUrl: "https://hslda.org/legal/florida", localGroupUrl: "https://www.fpea.com" },
  "Georgia":        { regulation: "Low",    notice: "File Declaration of Intent with local school superintendent", requiredSubjects: ["Reading","Language Arts","Math","Social Studies","Science","Health"], attendance: "180 days/year", testing: "None required", portfolios: "Keep annual attendance records", hsldaUrl: "https://hslda.org/legal/georgia", localGroupUrl: "https://www.ghea.org" },
  "Hawaii":         { regulation: "Medium", notice: "Register with Department of Education", requiredSubjects: ["Reading","Language Arts","Math","Social Studies","Science","Health"], attendance: "180 days/year", testing: "Annual assessment required", portfolios: "Submit annual assessment documentation", hsldaUrl: "https://hslda.org/legal/hawaii", localGroupUrl: "https://homeschoolhawaii.com" },
  "Idaho":          { regulation: "Low",    notice: "No notice required", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","Humanities"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/idaho", localGroupUrl: "https://www.idahohomeschool.com" },
  "Illinois":       { regulation: "Low",    notice: "No notice required; operate as private school", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Fine Arts","Health"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/illinois", localGroupUrl: "https://www.iche.org" },
  "Indiana":        { regulation: "Low",    notice: "No notice required", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/indiana", localGroupUrl: "https://www.iahe.net" },
  "Iowa":           { regulation: "Low",    notice: "No notice required (as of 2023 law)", requiredSubjects: ["None mandated"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/iowa", localGroupUrl: "https://www.niche.org" },
  "Kansas":         { regulation: "Low",    notice: "No notice required; operate as non-accredited private school", requiredSubjects: ["Reading","Math","Science","History"], attendance: "1,116 hours/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/kansas", localGroupUrl: "https://www.kansashomeschool.org" },
  "Kentucky":       { regulation: "Low",    notice: "Notify local superintendent", requiredSubjects: ["Reading","Writing","Math","Science","History","Civics","PE","Art","Music"], attendance: "185 days/year", testing: "None required", portfolios: "Keep attendance records", hsldaUrl: "https://hslda.org/legal/kentucky", localGroupUrl: "https://www.khen.org" },
  "Louisiana":      { regulation: "Low",    notice: "Submit letter of intent to local school board", requiredSubjects: ["Approved curriculum covering core subjects"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/louisiana", localGroupUrl: "https://www.lhea.org" },
  "Maine":          { regulation: "Medium", notice: "File annual approval with local superintendent by Sept 1", requiredSubjects: ["English","Math","Science","Social Studies","Health","PE","Fine Arts"], attendance: "175 days or 900 hours/year", testing: "Annual assessment (standardized test, portfolio, or certified evaluator)", portfolios: "Annual assessment documentation required", hsldaUrl: "https://hslda.org/legal/maine", localGroupUrl: "https://mheac.net" },
  "Maryland":       { regulation: "Medium", notice: "File notification with local superintendent by Sept 1", requiredSubjects: ["Math","English","Health","Fine Arts","Music"], attendance: "180 days/year", testing: "Annual portfolio review OR standardized test", portfolios: "Portfolio or test results required annually", hsldaUrl: "https://hslda.org/legal/maryland", localGroupUrl: "https://www.mdhomeed.org" },
  "Massachusetts":  { regulation: "High",   notice: "Get annual approval from local school committee BEFORE starting", requiredSubjects: ["Reading","Writing","Math","History","Science","Health","PE","Music","Art"], attendance: "990 hours/year", testing: "Annual assessment or portfolio review", portfolios: "Required for annual review", hsldaUrl: "https://hslda.org/legal/massachusetts", localGroupUrl: "https://www.ahem.info" },
  "Michigan":       { regulation: "Low",    notice: "No notice required; operate as non-public school", requiredSubjects: ["Reading","Writing","Math","Science","History","Government","Civics","Language","Health","PE","Arts"], attendance: "180 days or 1,098 hours/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/michigan", localGroupUrl: "https://www.inch.org" },
  "Minnesota":      { regulation: "Medium", notice: "File annual assessment report with local district by Oct 1", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE","Fine Arts"], attendance: "None specified", testing: "Annual assessment OR portfolio review", portfolios: "Annual assessment report required", hsldaUrl: "https://hslda.org/legal/minnesota", localGroupUrl: "https://www.mache.org" },
  "Mississippi":    { regulation: "Low",    notice: "File notice of intent with local school board", requiredSubjects: ["Language Arts","Math","Science","Social Studies"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/mississippi", localGroupUrl: "https://www.mhea.net" },
  "Missouri":       { regulation: "Low",    notice: "No notice required", requiredSubjects: ["Math","Language Arts","Reading","Social Studies","Science"], attendance: "1,000 hours/year", testing: "None required", portfolios: "Keep records (not required to submit)", hsldaUrl: "https://hslda.org/legal/missouri", localGroupUrl: "https://www.missourihomeschoolers.org" },
  "Montana":        { regulation: "Low",    notice: "File notice with county superintendent by Sept 1", requiredSubjects: ["Language Arts","Math","Social Studies","Science","Health","PE"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/montana", localGroupUrl: "https://www.mhea.net" },
  "Nebraska":       { regulation: "Medium", notice: "Notify school superintendent", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE"], attendance: "1,032 hours/year (elementary) / 1,080 hours (secondary)", testing: "None required", portfolios: "Annual records recommended", hsldaUrl: "https://hslda.org/legal/nebraska", localGroupUrl: "https://www.nche.net" },
  "Nevada":         { regulation: "Low",    notice: "File notification with school district", requiredSubjects: ["Reading","Writing","Math","English","Science","History/Social Studies","Art","Music","Health","PE"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/nevada", localGroupUrl: "https://www.nevadahomeschoolnetwork.com" },
  "New Hampshire":  { regulation: "Medium", notice: "File annual notice by Aug 1", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","Fine Arts","Computer Literacy"], attendance: "None specified", testing: "Annual assessment by Sept 1 (multiple options)", portfolios: "Documentation of annual assessment", hsldaUrl: "https://hslda.org/legal/new-hampshire", localGroupUrl: "https://www.learninfreedom.org" },
  "New Jersey":     { regulation: "Low",    notice: "No notice required", requiredSubjects: ["Equivalent to public school curriculum standards"], attendance: "180 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/new-jersey", localGroupUrl: "https://www.njhomeschool.org" },
  "New Mexico":     { regulation: "Low",    notice: "File notice with local public school district", requiredSubjects: ["Reading","Language Arts","Math","Science","Social Studies"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/new-mexico", localGroupUrl: "https://www.nmhea.org" },
  "New York":       { regulation: "High",   notice: "Submit Individualized Home Instruction Plan (IHIP) by Aug 1", requiredSubjects: ["Patriotism","Citizenship","English","Math","Science","Social Studies","Health","PE","Art","Music","Library Skills"], attendance: "900 hrs/year (K–6) / 990 hrs/year (7–12)", testing: "Annual standardized test OR portfolio review in grades 4 and 8", portfolios: "Quarterly reports required; annual assessment documentation", hsldaUrl: "https://hslda.org/legal/new-york", localGroupUrl: "https://www.leah.org" },
  "North Carolina": { regulation: "Medium", notice: "File notice of intent with State Non-Public Education Division", requiredSubjects: ["English","Math","Science","Social Studies","Health"], attendance: "9 months / 180 days", testing: "Annual standardized test required", portfolios: "Immunization records required", hsldaUrl: "https://hslda.org/legal/north-carolina", localGroupUrl: "https://www.nche.com" },
  "North Dakota":   { regulation: "High",   notice: "File annually with local school board", requiredSubjects: ["English","Math","Science","Social Studies","Health","PE","Fine Arts"], attendance: "175 days/year", testing: "Annual assessment required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/north-dakota", localGroupUrl: "https://www.ndhsa.org" },
  "Ohio":           { regulation: "Medium", notice: "File notice with local superintendent by Aug 1", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE","Fine Arts"], attendance: "900 hours/year", testing: "Annual assessment (test, portfolio, or evaluation)", portfolios: "Annual assessment report required", hsldaUrl: "https://hslda.org/legal/ohio", localGroupUrl: "https://www.oah.org" },
  "Oklahoma":       { regulation: "Low",    notice: "No notice required", requiredSubjects: ["None specified"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/oklahoma", localGroupUrl: "https://www.chefo.org" },
  "Oregon":         { regulation: "Medium", notice: "File notice of intent with local ESD", requiredSubjects: ["English","Math","Science","Social Studies","Health","PE","Fine Arts"], attendance: "None specified", testing: "Annual assessment in grades 3, 5, 8, and 10", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/oregon", localGroupUrl: "https://www.oregonhomeschool.net" },
  "Pennsylvania":   { regulation: "High",   notice: "File annual affidavit with local superintendent by Aug 1", requiredSubjects: ["English","Math","Science","Social Studies","Geography","Civics","Safety","Health","PE","Art","Music"], attendance: "180 days (900 hrs elementary / 990 hrs secondary)", testing: "Annual assessment (standardized test or portfolio reviewed by certified supervisor)", portfolios: "Portfolio required; reviewed annually by qualified evaluator", hsldaUrl: "https://hslda.org/legal/pennsylvania", localGroupUrl: "https://www.chap.net" },
  "Rhode Island":   { regulation: "Medium", notice: "File notice and curriculum with local school committee", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE","Music","Art"], attendance: "None specified", testing: "None required", portfolios: "Annual approval by school committee", hsldaUrl: "https://hslda.org/legal/rhode-island", localGroupUrl: "https://rihomeschoolassociation.org" },
  "South Carolina": { regulation: "Medium", notice: "Choose 1 of 3 accountability options (district, homeschool assoc., or SCAIHS)", requiredSubjects: ["Reading","Writing","Math","Science","Social Studies","Health","PE"], attendance: "180 days/year", testing: "Annual standardized test required", portfolios: "Records vary by accountability option chosen", hsldaUrl: "https://hslda.org/legal/south-carolina", localGroupUrl: "https://www.scaihs.org" },
  "South Dakota":   { regulation: "Low",    notice: "File annual notice of intent with local superintendent", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE","Fine Arts"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/south-dakota", localGroupUrl: "https://www.sdhomeschool.org" },
  "Tennessee":      { regulation: "Low",    notice: "File notice with local superintendent OR join a church-related school", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","PE","Art","Music"], attendance: "180 days/year", testing: "Annual standardized test required (ages 5–17)", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/tennessee", localGroupUrl: "https://www.tnhomeed.com" },
  "Texas":          { regulation: "Low",    notice: "No notice required (withdraw from public school with written notice)", requiredSubjects: ["Reading","Spelling","Grammar","Math","Good Citizenship"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/texas", localGroupUrl: "https://www.thsc.org" },
  "Utah":           { regulation: "Low",    notice: "File an affidavit with local school board", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Arts","Health","PE"], attendance: "None specified", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/utah", localGroupUrl: "https://www.uhea.net" },
  "Vermont":        { regulation: "High",   notice: "File enrollment notice with state", requiredSubjects: ["Reading","Writing","Math","Science","History","PE","Art","Music"], attendance: "175 days or 900 hours/year", testing: "Annual assessment by certified evaluator", portfolios: "Required for annual evaluation", hsldaUrl: "https://hslda.org/legal/vermont", localGroupUrl: "https://www.vermonthomeschool.net" },
  "Virginia":       { regulation: "Medium", notice: "File notice of intent with division superintendent by Aug 15", requiredSubjects: ["Math","Science","English","History","Social Studies","Fine Arts","Foreign Language (middle/high)"], attendance: "None specified", testing: "Annual assessment (standardized test, portfolio, or certified teacher evaluation)", portfolios: "Annual assessment documentation", hsldaUrl: "https://hslda.org/legal/virginia", localGroupUrl: "https://www.heav.org" },
  "Washington":     { regulation: "Medium", notice: "File annual Declaration of Intent by Sept 15", requiredSubjects: ["Occupational Ed","Math","Language Arts","Science","Social Studies","History","Health","PE","Reading","Writing"], attendance: "None specified", testing: "Annual assessment in grades 4, 8, and 11", portfolios: "Assessment records maintained", hsldaUrl: "https://hslda.org/legal/washington", localGroupUrl: "https://www.washhomeschool.org" },
  "West Virginia":  { regulation: "High",   notice: "Notify county superintendent", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health"], attendance: "180 days/year", testing: "Annual assessment required", portfolios: "Assessment results documented", hsldaUrl: "https://hslda.org/legal/west-virginia", localGroupUrl: "https://www.wvhomeschoolers.org" },
  "Wisconsin":      { regulation: "Low",    notice: "No notice required; report as private school", requiredSubjects: ["Reading","Math","Language Arts","Social Studies","Health","Science","Music","Art","PE"], attendance: "875 hours/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/wisconsin", localGroupUrl: "https://www.homeschoolforum.com" },
  "Wyoming":        { regulation: "Low",    notice: "Notify local board of trustees", requiredSubjects: ["Language Arts","Math","Science","Social Studies","Health","Art","Music","PE"], attendance: "175 days/year", testing: "None required", portfolios: "None required", hsldaUrl: "https://hslda.org/legal/wyoming", localGroupUrl: "https://www.wyhomeschoolers.org" },
};

// ─── Easy Wins ────────────────────────────────────────────────────────────────

const EASY_WINS: EasyWin[] = [
  { emoji: "🎨", title: "Salt Tray Writing",          desc: "Pour salt in a tray, practice spelling words or letters with a finger.",                  time: "5 min",    grade: "K–2",      url: "https://www.growinghandsonkids.com/" },
  { emoji: "🔭", title: "Shadow Tracing",             desc: "Trace your shadow at different times of day. Watch it move and discuss why.",              time: "10 min",   grade: "All Ages", url: "https://spaceplace.nasa.gov/" },
  { emoji: "📚", title: "Audiobook Hour",             desc: "Put on a great audiobook and do a puzzle together. Zero prep, total engagement.",          time: "0 min prep", grade: "All Ages", url: "https://librivox.org" },
  { emoji: "🌿", title: "Nature Alphabet Hunt",       desc: "Go outside and find something in nature for each letter of the alphabet.",                 time: "15 min",   grade: "K–5",      url: "https://www.kidsactivitiesblog.com/" },
  { emoji: "🍳", title: "Kitchen Math",               desc: "Double a recipe together. Real fractions, real reward, and everyone eats the results.",   time: "20 min",   grade: "3–8",      url: "https://www.khanacademy.org/math/early-math" },
  { emoji: "🎭", title: "History Podcast",            desc: "Put on a 'Stuff You Missed in History Class' episode during lunch or craft time.",         time: "0 min prep", grade: "All Ages", url: "https://www.missedinhistory.com" },
];

// ─── Virtual Tours ─────────────────────────────────────────────────────────────

type VirtualTour = { emoji: string; name: string; desc: string; grade: string; subject: string; url: string; };

const VIRTUAL_TOURS: VirtualTour[] = [
  { emoji: "🏯", name: "Walk the Great Wall of China",     url: "https://www.youtube.com/watch?v=VOopi18nzY4",           desc: "Narrated walking tour of one of the world's greatest wonders.",                                                                                grade: "All Ages", subject: "History/Geography" },
  { emoji: "🔺", name: "Inside the Egyptian Pyramids",     url: "https://www.youtube.com/watch?v=V9HIt9Cbfb0",           desc: "360° virtual tour inside the Pyramids of Giza.",                                                                                       grade: "All Ages", subject: "History/Science"   },
  { emoji: "🌿", name: "Amazon Rainforest Virtual Tour",   url: "https://www.youtube.com/watch?v=LPiyBe3UDPI",           desc: "Aerial and ground-level exploration of the rainforest.",                                                                                grade: "All Ages", subject: "Science/Nature"    },
  { emoji: "🐙", name: "Monterey Bay Aquarium Live",       url: "https://www.youtube.com/watch?v=NUnJc82ptd4",           desc: "Live underwater cameras from the famous aquarium.",                                                                                    grade: "All Ages", subject: "Science"           },
  { emoji: "🖼️", name: "The Louvre Museum Tour",           url: "https://www.youtube.com/watch?v=dHViKO9DrDA",           desc: "Walk the halls of the world's most visited museum.",                                                                                   grade: "All Ages", subject: "Art/History"       },
  { emoji: "📦", name: "Amazon Career Tours",              url: "https://www.amazonfutureengineer.com/alltours",          desc: "11+ free virtual career tours — AWS data centers, robotics, music production, space tech & more. Filterable by grade, 45 min each.",   grade: "K–12",     subject: "Career/Technology" },
  { emoji: "🌋", name: "Yellowstone National Park",        url: "https://www.youtube.com/watch?v=bme0rs75Z3E",           desc: "Geysers, wildlife, and volcanic landscapes in stunning detail.",                                                                        grade: "All Ages", subject: "Science/Nature"    },
  { emoji: "🚀", name: "International Space Station Tour", url: "https://www.youtube.com/watch?v=nmBbcNTUkOg",           desc: "NASA astronaut guides you through the ISS.",                                                                                           grade: "All Ages", subject: "Science/Space"     },
  { emoji: "🥒", name: "Mount Olive Pickle Factory Tour",  url: "https://www.youtube.com/watch?v=CqZJaFJVkBo",           desc: "See how pickles are made inside the Mount Olive Pickle Company — a real-world look at food manufacturing.",                            grade: "All Ages", subject: "Career/Food Science" },
];

// ─── Browse categories ───────────────────────────────────────────────────────

const BROWSE_CATS = [
  { id: "all",            label: "All"                },
  { id: "curriculum",     label: "📚 Curriculum"      },
  { id: "online_classes", label: "🖥️ Online Classes" },
  { id: "science",        label: "🔬 Science"         },
  { id: "field_trips",    label: "🌍 Field Trips"     },
  { id: "printables",     label: "🖨️ Printables"     },
  { id: "discounts",      label: "💰 Discounts"       },
  { id: "tours",          label: "🎬 Virtual Tours"   },
  { id: "states",         label: "🗺️ By State"       },
  { id: "saved",          label: "🔖 Saved"           },
];

const PICK_CARD_COLORS = [
  { bg: "#eef5ec", accent: "#3d7045" },
  { bg: "#fef5e4", accent: "#8b6820" },
  { bg: "#e4f2fb", accent: "#1a5c80" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get the Monday 00:00 UTC of the current week as a seed for rotation */
function getMondaySeed(): number {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).getTime();
}

/** Deterministic shuffle using a seed */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isNewThisWeek(createdAt?: string): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return created > weekAgo;
}

function getCategoryEmoji(cat: string): string {
  const map: Record<string, string> = {
    curriculum: "📚", online_classes: "🖥️", science: "🔬",
    field_trips: "🌍", printables: "🖨️", discounts: "💰",
  };
  return map[cat] || "🌿";
}

function getCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    curriculum: "Curriculum", online_classes: "Online Classes", science: "Science",
    field_trips: "Field Trip", printables: "Printables", discounts: "Discount",
  };
  return map[cat] || cat;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl p-5 animate-pulse shadow-sm">
          <div className="h-4 bg-gray-200 rounded-full w-3/4 mb-3" />
          <div className="h-3 bg-gray-100 rounded-full w-full mb-2" />
          <div className="h-3 bg-gray-100 rounded-full w-1/2 mb-3" />
          <div className="flex gap-2">
            <div className="h-5 w-14 bg-gray-100 rounded-full" />
            <div className="h-5 w-20 bg-gray-100 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function BookmarkBtn({ id, savedMap, onToggle }: { id: string; savedMap: Record<string, string>; onToggle: (id: string) => void }) {
  const saved = Boolean(savedMap[id]);
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(id); }}
      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        saved ? "bg-[#e4f0e6] text-[#4a7c59] hover:bg-[#d4e8d6]" : "bg-[#f5f3f0] text-[#c8bfb5] hover:text-[#7a6f65] hover:bg-[#ede8e2]"
      }`}
      title={saved ? "Remove bookmark" : "Save resource"}
    >
      {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
    </button>
  );
}

function GradePill({ grade }: { grade: string }) {
  return (
    <span className="bg-[#e8f0e9] text-[#3d5c42] rounded-full px-2 py-0.5 text-xs font-semibold">
      {grade}
    </span>
  );
}

function ResourceCard({ r, savedMap, onToggle }: { r: DbResource; savedMap: Record<string, string>; onToggle: (id: string) => void }) {
  const isNew = isNewThisWeek(r.created_at);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
      <div className="flex items-start gap-3">
        <div className="bg-[#f5f3f0] rounded-xl w-10 h-10 flex items-center justify-center shrink-0 text-xl">
          {getCategoryEmoji(r.category)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <a href={r.url} target="_blank" rel="noopener noreferrer"
              className="font-bold text-[#2d2926] text-sm hover:text-[#4a7c59] hover:underline transition-colors leading-snug flex items-center gap-1.5">
              {r.title}
              <ExternalLink size={12} className="text-[#b5aca4] shrink-0" />
            </a>
            <BookmarkBtn id={r.id} savedMap={savedMap} onToggle={onToggle} />
          </div>
          <p className="text-xs text-[#7a6f65] leading-relaxed mb-2.5 line-clamp-2">{r.description}</p>
          <div className="flex gap-1.5 flex-wrap">
            <GradePill grade={r.grade_level} />
            <span className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">{getCategoryLabel(r.category)}</span>
            {r.badge_text && (
              <span className="text-[10px] font-medium bg-[#e4f0e6] text-[#3d5c42] px-2 py-0.5 rounded-full">{r.badge_text}</span>
            )}
            {isNew && (
              <span className="text-[10px] font-bold bg-[#fef5e4] text-[#8b6820] px-2 py-0.5 rounded-full">New 🌱</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  const { effectiveUserId } = usePartner();

  const [browseFilter,   setBrowseFilter]   = useState("all");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [showAllWins,    setShowAllWins]    = useState(false);
  const [stateExpanded,  setStateExpanded]  = useState(false);
  const [stateSearch,    setStateSearch]    = useState("");
  const [selectedLevel,  setSelectedLevel]  = useState<RegLevel | "all">("all");
  const [expandedState,  setExpandedState]  = useState<string | null>(null);
  const [savedMap,       setSavedMap]       = useState<Record<string, string>>({});
  const [loadingSaved,   setLoadingSaved]   = useState(true);
  const [dbResources,    setDbResources]    = useState<DbResource[]>([]);
  const [dbLoading,      setDbLoading]      = useState(true);
  const [userState,      setUserState]      = useState<string | null>(null);
  const [stateLoaded,    setStateLoaded]    = useState(false);
  const [selectedTour,   setSelectedTour]   = useState<{ title: string; url: string } | null>(null);

  const stateRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => { document.title = "Resources \u00b7 Rooted"; }, []);
  useEffect(() => { localStorage.setItem("rooted_visited_resources", "true"); }, []);

  // Load DB resources (including created_at and is_free_pick)
  useEffect(() => {
    supabase
      .from("resources")
      .select("id, category, title, description, url, grade_level, badge_text, metadata, is_free_pick, created_at")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) setDbResources(data as DbResource[]);
        setDbLoading(false);
      });
  }, []);

  // Load user state
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from("profiles").select("state").eq("id", effectiveUserId).maybeSingle()
      .then(({ data, error }) => {
        if (!error) setUserState((data as { state?: string } | null)?.state ?? null);
        setStateLoaded(true);
      });
  }, [effectiveUserId]);

  // Load saved resources
  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from("app_events").select("id, payload").eq("user_id", effectiveUserId).eq("type", "saved_resource")
      .then(({ data }) => {
        const map: Record<string, string> = {};
        data?.forEach((e) => { if (e.payload?.resource_id) map[e.payload.resource_id] = e.id; });
        setSavedMap(map);
        setLoadingSaved(false);
      });
  }, [effectiveUserId]);

  // Auto-scroll to user's state
  useEffect(() => {
    if (browseFilter === "states" && userState && stateRefs.current[userState]) {
      setTimeout(() => stateRefs.current[userState!]?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
    }
  }, [browseFilter, userState]);

  const toggleSave = useCallback(async (resourceId: string) => {
    if (!effectiveUserId) return;
    if (savedMap[resourceId]) {
      const eventId = savedMap[resourceId];
      setSavedMap((prev) => { const n = { ...prev }; delete n[resourceId]; return n; });
      await supabase.from("app_events").delete().eq("id", eventId);
    } else {
      const { data } = await supabase.from("app_events")
        .insert({ user_id: effectiveUserId, type: "saved_resource", payload: { resource_id: resourceId } })
        .select("id").single();
      if (data) setSavedMap((prev) => ({ ...prev, [resourceId]: data.id }));
    }
  }, [effectiveUserId, savedMap]);

  // ── Compute Discover data ──────────────────────────────────────────────────

  // Free Picks: auto-rotate weekly from is_free_pick resources
  const freePicks = dbResources.filter((r) => r.is_free_pick);
  const mondaySeed = getMondaySeed();
  const weeklyPicks = seededShuffle(freePicks, mondaySeed).slice(0, 3);

  // Easy Wins
  const dbEasyWins = dbResources.filter((r) => r.category === "easy_win");
  const easyWinPool: EasyWin[] = dbEasyWins.length > 0
    ? dbEasyWins.map((r) => ({
        emoji: r.badge_text?.slice(0, 2) || "⚡", title: r.title,
        desc: r.description, time: r.grade_level || "", grade: r.grade_level || "All Ages", url: r.url,
      }))
    : EASY_WINS;
  const validWins = easyWinPool.filter((w) => w.title && w.desc);

  // ── Compute Browse data ────────────────────────────────────────────────────

  const browsableCategories = ["curriculum", "online_classes", "science", "field_trips", "printables", "discounts"];
  const browsableResources = dbResources.filter((r) => browsableCategories.includes(r.category));

  const filteredBrowse = browsableResources.filter((r) => {
    if (browseFilter !== "all" && !["tours", "states", "saved"].includes(browseFilter) && r.category !== browseFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!r.title.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const filteredStates = Object.entries(STATE_REQS).filter(([name, { level }]) =>
    name.toLowerCase().includes(stateSearch.toLowerCase()) &&
    (selectedLevel === "all" || level === selectedLevel)
  );

  const savedItems = dbResources.filter((r) => savedMap[r.id]);

  function getEmbedUrl(url: string): string {
    const match = url.match(/[?&]v=([^&]+)/);
    if (match) return `https://www.youtube.com/embed/${match[1]}?autoplay=1`;
    return '';
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
    <PageHero overline="Discover" title="Resources 🌿" subtitle="Curated for your homeschool." />
    <div className="max-w-3xl px-4 pt-6 pb-8 space-y-8" style={{ background: "#faf9f6" }}>

      {/* ════════════════════════════════════════════════════════════
          ZONE 1 — DISCOVER
         ════════════════════════════════════════════════════════════ */}

      {/* ── Today's Easy Win ─────────────────────────────────────── */}
      {validWins.length > 0 && (() => {
        const todayIdx = new Date().getDate() % validWins.length;
        const win = validWins[todayIdx];
        return (
          <div className="space-y-2">
            <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(135deg, #2d5a3d 0%, #3d7a50 100%)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/70">{"\u26A1"} Today&apos;s easy win</span>
                <span className="text-[10px] text-white/40">{"\u21BB"} New idea tomorrow</span>
              </div>
              <div className="text-3xl mb-2">{win.emoji}</div>
              <h3 className="text-lg font-bold mb-1">{win.title}</h3>
              <p className="text-sm text-white/80 leading-relaxed mb-3">{win.desc}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {win.time && <span className="text-[10px] font-medium bg-white/15 px-2 py-0.5 rounded-full">{"\u23F1"} {win.time}</span>}
                {win.grade && <span className="text-[10px] font-medium bg-white/15 px-2 py-0.5 rounded-full">{win.grade}</span>}
                {win.url && (
                  <a href={win.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-semibold bg-white text-[#3d5c42] px-3 py-1 rounded-lg hover:bg-white/90 transition-colors">
                    Try it {"\u2192"}
                  </a>
                )}
              </div>
            </div>
            <button onClick={() => setShowAllWins(!showAllWins)} className="text-xs text-[#5c7f63] font-medium hover:underline">
              {showAllWins ? "Hide ideas" : `See all ${validWins.length} ideas \u2192`}
            </button>
            {showAllWins && (
              <div className="grid grid-cols-2 gap-2">
                {validWins.filter((_, i) => i !== todayIdx).map((w) => (
                  <a key={w.title} href={w.url} target="_blank" rel="noopener noreferrer" className="bg-white border border-[#e8e2d9] rounded-xl p-3 hover:border-[#5c7f63] transition-colors">
                    <div className="text-xl mb-1">{w.emoji}</div>
                    <p className="text-xs font-semibold text-[#2d2926] mb-0.5">{w.title}</p>
                    <p className="text-[10px] text-[#7a6f65]">{w.time}</p>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── This Week's Free Picks (auto-rotating) ────────────── */}
      {weeklyPicks.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-[#2d2926] mb-1" style={{ fontFamily: "var(--font-display)" }}>This Week&apos;s Free Picks {"\u2B50"}</h2>
          <p className="text-xs text-[#7a6f65] mb-4">Refreshes every Monday</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {weeklyPicks.map((r, i) => {
              const col = PICK_CARD_COLORS[i % PICK_CARD_COLORS.length];
              const isNew = isNewThisWeek(r.created_at);
              return (
                <div key={r.id} className="rounded-2xl overflow-hidden border border-white/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all" style={{ background: col.bg }}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block p-5">
                    <div className="text-4xl mb-2">{getCategoryEmoji(r.category)}</div>
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <p className="text-sm font-bold text-[#2d2926] leading-snug">{r.title} {"\u2197"}</p>
                      <BookmarkBtn id={r.id} savedMap={savedMap} onToggle={toggleSave} />
                    </div>
                    <p className="text-[11px] text-[#5c5550] leading-snug mb-2">{r.description}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      <GradePill grade={r.grade_level} />
                      {r.badge_text && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${col.accent}22`, color: col.accent }}>{r.badge_text}</span>
                      )}
                      {isNew && (
                        <span className="text-[10px] font-bold bg-[#fef5e4] text-[#8b6820] px-2 py-0.5 rounded-full">New 🌱</span>
                      )}
                    </div>
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Personalized State Banner ─────────────────────────── */}
      {stateLoaded && userState && userState !== "Outside the US" && STATE_INFO[userState] ? (() => {
        const info = STATE_INFO[userState];
        const badge = REG_BADGE[info.regulation];
        return (
          <div className="rounded-2xl border border-[#b8d4be] overflow-hidden" style={{ background: "linear-gradient(135deg, #eef5ec 0%, #f5fbf0 100%)" }}>
            <button
              onClick={() => setStateExpanded(!stateExpanded)}
              className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">{"\uD83D\uDCCB"}</span>
                <span className="text-sm font-semibold text-[#2d2926]">{userState}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: badge.bg, color: badge.color }}>
                  {info.regulation}
                </span>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                className="shrink-0 text-[#7a6f65] transition-transform duration-200"
                style={{ transform: stateExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                <path d="M3 5.5L7 9.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {stateExpanded && (
              <>
                <div className="border-t border-[#d4e8d8] px-5 py-4 space-y-3">
                  {[
                    { icon: "\uD83D\uDCCB", label: "Required Subjects", value: info.requiredSubjects.join(", ") },
                    { icon: "\uD83C\uDFDB\uFE0F", label: "Notice Required", value: info.notice },
                    { icon: "\uD83D\uDCCA", label: "Attendance / Days", value: info.attendance },
                    { icon: "\uD83D\uDCDD", label: "Testing", value: info.testing },
                    { icon: "\uD83D\uDDC2\uFE0F", label: "Portfolio / Records", value: info.portfolios },
                  ].map((row) => (
                    <div key={row.label} className="flex gap-3">
                      <span className="text-base shrink-0 mt-0.5">{row.icon}</span>
                      <div>
                        <p className="text-[11px] font-semibold text-[#2d2926] mb-0.5">{row.label}</p>
                        <p className="text-xs text-[#5c5550] leading-relaxed">{row.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-5 pb-4 flex gap-2 flex-wrap">
                  <a href={info.hsldaUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#4a7c59] hover:bg-[#3a6048] px-3 py-1.5 rounded-lg transition-colors">
                    HSLDA State Page {"\u2192"}
                  </a>
                  <a href={info.localGroupUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#4a7c59] border border-[#b8d4be] bg-white hover:bg-[#f0f8f0] px-3 py-1.5 rounded-lg transition-colors">
                    Local Association {"\u2192"}
                  </a>
                </div>
                <p className="px-5 pb-4 text-[10px] text-[#8aaa90] italic leading-relaxed">
                  Laws change — always verify with your state homeschool association or HSLDA.org.
                </p>
              </>
            )}
          </div>
        );
      })() : stateLoaded && userState === "Outside the US" ? (
        <div className="rounded-2xl p-4 border border-[#e0dbd4] bg-[#fefcf9] flex items-center gap-3">
          <MapPin size={16} className="text-[#b5aca4]" />
          <p className="text-sm text-[#7a6f65]">
            You&apos;re homeschooling outside the US — check your local education authority for requirements.
          </p>
        </div>
      ) : stateLoaded ? (
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-3 rounded-2xl p-4 border border-dashed border-[#c8ddb8] bg-[#f5fbf2] hover:bg-[#eef7ea] transition-colors group"
        >
          <MapPin size={16} className="text-[#7aaa78]" />
          <p className="text-sm text-[#5c7a62]">
            Add your state in Settings to see personalized resources
            <span className="ml-1 text-[#4a7c59] group-hover:underline">→</span>
          </p>
        </Link>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          ZONE 2 — BROWSE
         ════════════════════════════════════════════════════════════ */}

      <div className="space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#a09890]">Browse Everything</p>

        {/* ── Search bar ────────────────────────────────────────── */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#b5aca4]" />
          <input
            type="text"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#e8e2d9] bg-white focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20 text-[#2d2926] placeholder-[#c8bfb5]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#b5aca4] hover:text-[#7a6f65]">
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Filter pills ──────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {BROWSE_CATS.map((cat) => (
            <button
              key={cat.id}
              onClick={() => { setBrowseFilter(cat.id); if (!["states", "saved"].includes(cat.id)) setSearchQuery(""); }}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap relative ${
                browseFilter === cat.id
                  ? "bg-[#4a7c59] text-white shadow-sm"
                  : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#4a7c59] hover:text-[#2d2926]"
              }`}
            >
              {cat.label}
              {cat.id === "saved" && Object.keys(savedMap).length > 0 && (
                <span className="ml-1.5 text-[10px] font-bold bg-white/30 px-1.5 py-0.5 rounded-full">
                  {Object.keys(savedMap).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Resource cards (all browsable categories) ──────── */}
        {!["tours", "states", "saved"].includes(browseFilter) && (
          <div className="space-y-3">
            {dbLoading ? <LoadingSkeleton /> : filteredBrowse.length === 0 ? (
              <p className="text-sm text-[#b5aca4] text-center py-10">
                {searchQuery ? `No resources match "${searchQuery}"` : "No resources in this category yet."}
              </p>
            ) : (
              filteredBrowse.map((r) => (
                <ResourceCard key={r.id} r={r} savedMap={savedMap} onToggle={toggleSave} />
              ))
            )}
          </div>
        )}

        {/* ── Virtual Tours ───────────────────────────────────── */}
        {browseFilter === "tours" && (
          <div className="space-y-3">
            <p className="text-xs text-[#7a6f65]">Free virtual field trips and immersive video experiences — click Watch to play inline.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {VIRTUAL_TOURS.map((tour) => {
                const isYouTube = /[?&]v=/.test(tour.url);
                return (
                  <div key={tour.name} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden">
                    <div className="p-5">
                      <div className="text-4xl mb-3">{tour.emoji}</div>
                      <p className="font-bold text-[#2d2926] text-sm leading-snug mb-1.5">{tour.name}</p>
                      <p className="text-xs text-[#7a6f65] leading-relaxed mb-3">{tour.desc}</p>
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <GradePill grade={tour.grade} />
                        <span className="text-[10px] font-medium bg-[#e4f2fb] text-[#1a5c80] px-2 py-0.5 rounded-full">{tour.subject}</span>
                      </div>
                      {isYouTube ? (
                        <button onClick={() => setSelectedTour({ title: tour.name, url: tour.url })}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#4a7c59] hover:bg-[#3a6048] px-3 py-1.5 rounded-lg transition-colors">
                          Watch ▶
                        </button>
                      ) : (
                        <a href={tour.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#4a7c59] hover:bg-[#3a6048] px-3 py-1.5 rounded-lg transition-colors">
                          Watch ↗
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── By State ────────────────────────────────────────── */}
        {browseFilter === "states" && (
          <div className="space-y-4">
            <p className="text-xs text-[#7a6f65]">
              Requirements vary widely. Always verify with your state homeschool association or{" "}
              <a href="https://hslda.org" target="_blank" rel="noopener noreferrer" className="text-[#4a7c59] hover:underline">HSLDA.org</a>.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <input type="text" placeholder="Search state..." value={stateSearch} onChange={(e) => setStateSearch(e.target.value)}
                className="flex-1 min-w-32 px-3.5 py-2 text-sm rounded-xl border border-[#e8e2d9] bg-white focus:outline-none focus:border-[#4a7c59] focus:ring-1 focus:ring-[#4a7c59]/30" />
              {(["all", "none", "low", "moderate", "high"] as const).map((l) => (
                <button key={l} onClick={() => setSelectedLevel(l)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${selectedLevel === l ? "bg-[#4a7c59] text-white" : "bg-white border border-[#e8e2d9] text-[#7a6f65] hover:border-[#4a7c59]"}`}>
                  {l === "all" ? "All" : LEVEL_LABELS[l as RegLevel].label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {filteredStates.length === 0 && (
                <p className="text-sm text-[#b5aca4] text-center py-8">No states match your search.</p>
              )}
              {filteredStates.map(([name, { level, summary }]) => {
                const lInfo = LEVEL_LABELS[level];
                const isExpanded = expandedState === name;
                const isYours = userState === name;
                return (
                  <div key={name} ref={(el) => { stateRefs.current[name] = el; }}
                    className={`bg-white rounded-2xl border transition-all overflow-hidden ${isYours ? "border-[#4a7c59] ring-1 ring-[#4a7c59]/20" : "border-gray-100 hover:border-[#c8d8cc]"}`}>
                    <button onClick={() => setExpandedState(isExpanded ? null : name)}
                      className="w-full flex items-center justify-between px-5 py-3.5 text-left">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-semibold text-sm text-[#2d2926]">{name}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: lInfo.bg, color: lInfo.color }}>{lInfo.label}</span>
                        {isYours && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#e4f0e6] text-[#4a7c59]">📍 Your State</span>
                        )}
                      </div>
                      <ChevronDown size={14} className={`text-[#b5aca4] transition-transform shrink-0 ml-2 ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                    {isExpanded && (
                      <div className="px-5 pb-4 border-t border-gray-50">
                        <p className="text-xs text-[#5c5550] leading-relaxed pt-3">{summary}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Saved ───────────────────────────────────────────── */}
        {browseFilter === "saved" && (
          <div className="space-y-3">
            {loadingSaved ? (
              <LoadingSkeleton />
            ) : savedItems.length === 0 ? (
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-10 flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#e8f0e9] flex items-center justify-center mb-4">
                  <Bookmark size={22} className="text-[#5c7f63]" />
                </div>
                <p className="text-base font-semibold text-[#2d2926] mb-1.5">Nothing saved yet</p>
                <p className="text-sm text-[#7a6f65] max-w-xs leading-relaxed">
                  Tap the 🔖 icon on any resource to save it here for quick access.
                </p>
              </div>
            ) : (
              savedItems.map((r) => (
                <ResourceCard key={r.id} r={r} savedMap={savedMap} onToggle={toggleSave} />
              ))
            )}
          </div>
        )}
      </div>

      <div className="h-4" />

      {/* ── YouTube embed modal ──────────────────────────────── */}
      {selectedTour && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelectedTour(null)}>
          <div className="bg-white rounded-xl w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h3 className="font-semibold text-[#2d2926] text-sm">{selectedTour.title}</h3>
              <button onClick={() => setSelectedTour(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="aspect-video">
              <iframe src={getEmbedUrl(selectedTour.url)} className="w-full h-full rounded-b-xl"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
