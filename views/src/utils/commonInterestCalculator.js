// Common Interest Calculation Utilities

export const MINIMUM_BORROWING = 20000;
export const COMMON_INTEREST_RATE = 0.15;

/**
 * Analyze member borrowing status
 */
export function analyzeMembers(monthlyBalances) {
  const neverBorrowed = [];
  const belowMinimum = [];
  const atOrAboveMinimum = [];
  const memberShortfalls = new Map();
  let totalShortfall = 0;

  monthlyBalances.forEach(balance => {
    const borrowing = balance.cumulativeBorrowing;

    if (borrowing === 0) {
      neverBorrowed.push(balance.memberId);
      const shortfall = MINIMUM_BORROWING - borrowing;
      memberShortfalls.set(balance.memberId, shortfall);
      totalShortfall += shortfall;
    } else if (borrowing < MINIMUM_BORROWING) {
      belowMinimum.push(balance.memberId);
      const shortfall = MINIMUM_BORROWING - borrowing;
      memberShortfalls.set(balance.memberId, shortfall);
      totalShortfall += shortfall;
    } else {
      atOrAboveMinimum.push(balance.memberId);
      memberShortfalls.set(balance.memberId, 0);
    }
  });

  return {
    neverBorrowed,
    belowMinimum,
    atOrAboveMinimum,
    totalShortfall,
    memberShortfalls,
  };
}

/**
 * Calculate unborrowed money and common interest
 */
export function calculateUnborrowedAndInterest(
  totalSavings,
  socialFundCollected,
  membershipFeesCollected,
  totalLoansDisbursed
) {
  const unborrowed = (totalSavings + socialFundCollected + membershipFeesCollected) - totalLoansDisbursed;
  const commonInterest = unborrowed * COMMON_INTEREST_RATE;

  return { unborrowed, commonInterest };
}

/**
 * Calculate common interest allocations based on admin's chosen method
 */
export function calculateCommonInterestAllocations(
  monthlyBalances,
  allocationMethod,
  commonInterestAmount,
  analysis
) {
  const allocations = [];

  if (allocationMethod === 'never_borrowed_only') {
    // Equal split among never borrowed members
    const eligibleCount = analysis.neverBorrowed.length;

    if (eligibleCount === 0) {
      return []; // No one to allocate to
    }

    const chargePerMember = commonInterestAmount / eligibleCount;

    analysis.neverBorrowed.forEach(memberId => {
      const balance = monthlyBalances.find(b => b.memberId === memberId);
      if (balance) {
        const shortfall = analysis.memberShortfalls.get(memberId) || 0;
        allocations.push({
          memberId,
          memberName: balance.memberName,
          eligibilityStatus: 'never_borrowed',
          shortfall,
          assignedBase: shortfall,
          charge: Math.round(chargePerMember * 100) / 100, // Round to 2 decimals
          allocationMethod: 'equal_sharing',
        });
      }
    });
  } else if (allocationMethod === 'never_borrowed_and_below_minimum') {
    // Proportional to shortfall among never borrowed + below minimum
    const eligibleMembers = [...analysis.neverBorrowed, ...analysis.belowMinimum];

    if (eligibleMembers.length === 0 || analysis.totalShortfall === 0) {
      return [];
    }

    eligibleMembers.forEach(memberId => {
      const balance = monthlyBalances.find(b => b.memberId === memberId);
      if (balance) {
        const shortfall = analysis.memberShortfalls.get(memberId) || 0;
        const proportionalCharge = (shortfall / analysis.totalShortfall) * commonInterestAmount;

        allocations.push({
          memberId,
          memberName: balance.memberName,
          eligibilityStatus: balance.cumulativeBorrowing === 0 ? 'never_borrowed' : 'borrowed_below_minimum',
          shortfall,
          assignedBase: shortfall,
          charge: Math.round(proportionalCharge * 100) / 100,
          allocationMethod: 'proportional_sharing',
        });
      }
    });
  } else if (allocationMethod === 'all_members') {
    // Equal split among ALL members (used when all met minimum)
    const totalMembers = monthlyBalances.length;
    const chargePerMember = commonInterestAmount / totalMembers;

    monthlyBalances.forEach(balance => {
      allocations.push({
        memberId: balance.memberId,
        memberName: balance.memberName,
        eligibilityStatus: 'at_or_above_minimum',
        shortfall: 0,
        assignedBase: 0,
        charge: Math.round(chargePerMember * 100) / 100,
        allocationMethod: 'equal_sharing_all',
      });
    });
  }

  return allocations;
}

/**
 * Validate if "All Members" option is applicable
 */
export function canUseAllMembersOption(analysis, totalMembers) {
  // Can only use if ALL members have met the minimum borrowing requirement
  return analysis.atOrAboveMinimum.length === totalMembers;
}

// Export the functions (for Node.js)
// if (typeof module !== 'undefined' && module.exports) {
//   module.exports = {
//     analyzeMembers,
//     calculateUnborrowedAndInterest,
//     calculateCommonInterestAllocations,
//     canUseAllMembersOption,
//     MINIMUM_BORROWING,
//     COMMON_INTEREST_RATE
//   };
// }