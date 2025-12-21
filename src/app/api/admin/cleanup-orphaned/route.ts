import { NextResponse } from "next/server";
import { agentRuntime } from "@/lib/agent-runtime";
import { ConsignmentDB, TokenDB } from "@/services/database";
import type { OTCConsignment } from "@/types";

/**
 * Clean up orphaned consignments (consignments with non-existent tokens)
 * POST /api/admin/cleanup-orphaned
 *
 * This endpoint removes consignments that reference tokens that don't exist.
 * Useful for cleaning up test data or fixing data integrity issues.
 */
export async function POST() {
	const runtime = await agentRuntime.getRuntime();

	// Get all consignment IDs
	const allConsignmentIds =
		(await runtime.getCache<string[]>("all_consignments")) || [];

	const orphanedIds: string[] = [];
	const cleanedByToken: Record<string, string[]> = {};

	// Check each consignment
	for (const consignmentId of allConsignmentIds) {
		const consignment = await runtime.getCache<OTCConsignment>(
			`consignment:${consignmentId}`,
		);

		if (!consignment) {
			// Consignment entry doesn't exist but ID is in list
			orphanedIds.push(consignmentId);
			continue;
		}

		// Check if token exists
		try {
			await TokenDB.getToken(consignment.tokenId);
		} catch {
			// Token doesn't exist - this consignment is orphaned
			orphanedIds.push(consignmentId);
			if (!cleanedByToken[consignment.tokenId]) {
				cleanedByToken[consignment.tokenId] = [];
			}
			cleanedByToken[consignment.tokenId].push(consignmentId);

			// Delete the consignment entry
			await runtime.setCache(`consignment:${consignmentId}`, null);

			// Remove from token_consignments list
			const tokenConsignments =
				(await runtime.getCache<string[]>(
					`token_consignments:${consignment.tokenId}`,
				)) || [];
			const filteredTokenConsignments = tokenConsignments.filter(
				(id) => id !== consignmentId,
			);
			await runtime.setCache(
				`token_consignments:${consignment.tokenId}`,
				filteredTokenConsignments,
			);

			// Remove from consigner_consignments list
			const consignerConsignments =
				(await runtime.getCache<string[]>(
					`consigner_consignments:${consignment.consignerAddress}`,
				)) || [];
			const filteredConsignerConsignments = consignerConsignments.filter(
				(id) => id !== consignmentId,
			);
			await runtime.setCache(
				`consigner_consignments:${consignment.consignerAddress}`,
				filteredConsignerConsignments,
			);
		}
	}

	// Update the all_consignments list
	const cleanedAllConsignments = allConsignmentIds.filter(
		(id) => !orphanedIds.includes(id),
	);
	await runtime.setCache("all_consignments", cleanedAllConsignments);

	return NextResponse.json({
		success: true,
		message: `Cleaned up ${orphanedIds.length} orphaned consignments`,
		orphanedIds,
		cleanedByToken,
		remainingConsignments: cleanedAllConsignments.length,
	});
}

/**
 * GET /api/admin/cleanup-orphaned
 * Check for orphaned consignments without cleaning them up
 */
export async function GET() {
	const runtime = await agentRuntime.getRuntime();

	// Get all consignment IDs
	const allConsignmentIds =
		(await runtime.getCache<string[]>("all_consignments")) || [];

	const orphaned: { id: string; tokenId: string; consigner: string }[] = [];

	// Check each consignment
	for (const consignmentId of allConsignmentIds) {
		const consignment = await runtime.getCache<OTCConsignment>(
			`consignment:${consignmentId}`,
		);

		if (!consignment) {
			orphaned.push({
				id: consignmentId,
				tokenId: "unknown",
				consigner: "unknown",
			});
			continue;
		}

		// Check if token exists
		try {
			await TokenDB.getToken(consignment.tokenId);
		} catch {
			orphaned.push({
				id: consignmentId,
				tokenId: consignment.tokenId,
				consigner: consignment.consignerAddress,
			});
		}
	}

	return NextResponse.json({
		success: true,
		totalConsignments: allConsignmentIds.length,
		orphanedCount: orphaned.length,
		orphaned,
	});
}
