// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAggregatorV3 as AggregatorV3Interface} from "./interfaces/IAggregatorV3.sol";
import {IOTC} from "./interfaces/IOTC.sol";

// Custom errors for gas-efficient reverts
error NotApprover();
error ZeroAddress();
error ZeroAgent();
error InvalidUsdcDecimals();
error InvalidEthFeedDecimals();
error InvalidRequiredApprovals();
error LockupTooLong();
error GasDepositTooHigh();
error NotAuthorized();
error TokenExists();
error InvalidDecimals();
error TokenNotActive();
error ZeroAmount();
error InvalidDealAmounts();
error InvalidDiscountRange();
error InvalidLockupRange();
error InsufficientGasDeposit();
error ZeroAmountReceived();
error RefundFailed();
error NotConsigner();
error NotActive();
error NothingToWithdraw();
error InvalidToken();
error InsufficientDepositedBalance();
error GasRefundFailed();
error BatchTooLarge();
error NoGasDepositsToWithdraw();
error WithdrawalFailed();
error TokenNotRegistered();
error ConsignmentNotActive();
error AmountOutOfRange();
error InsufficientRemaining();
error DiscountOutOfRange();
error LockupOutOfRange();
error CommissionOutOfRange();
error MustUseFixedDiscount();
error MustUseFixedLockup();
error P2PNoCommission();
error MinUsdNotMet();
error NoOffer();
error BadState();
error AlreadyApproved();
error NonNegotiableP2P();
error AlreadyApprovedByYou();
error PriceVolatilityExceeded();
error AlreadyPaid();
error NoAuth();
error NotExpired();
error NotApproved();
error Expired();
error FulfillApproverOnly();
error FulfillRestricted();
error InsufficientEth();
error Locked();
error NotBeneficiary();
error InvalidMax();
error EmergencyRefundsDisabled();
error InvalidStateForRefund();
error NotAuthorizedForRefund();
error TooEarlyForEmergencyRefund();
error EthRefundFailed();
error MustWait180Days();
error BadPrice();
error StaleRound();
error StalePrice();
error EthTransferFailed();
error NotEth();
error NotUsdc();

/// @title OTC-like Token Sale Desk - Multi-Token Support
/// @notice Permissionless consignment creation, approver-gated approvals, price snapshot on creation using Chainlink.
///         Multi-token support with per-token consignments. Supports ETH or USDC payments.
contract OTC is IOTC, Ownable2Step, Pausable, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using Math for uint256;
  enum PaymentCurrency { ETH, USDC }

  struct RegisteredToken {
    address tokenAddress;
    uint8 decimals;
    bool isActive;
    address priceOracle;
  }

  struct Consignment {
    bytes32 tokenId;
    address consigner;
    uint256 totalAmount;
    uint256 remainingAmount;
    bool isNegotiable;
    uint16 fixedDiscountBps;
    uint32 fixedLockupDays;
    uint16 minDiscountBps;
    uint16 maxDiscountBps;
    uint32 minLockupDays;
    uint32 maxLockupDays;
    uint256 minDealAmount;
    uint256 maxDealAmount;
    uint16 maxPriceVolatilityBps;
    bool isActive;
    uint256 createdAt;
  }

  struct Offer {
    uint256 consignmentId;
    bytes32 tokenId;
    address beneficiary;
    uint256 tokenAmount;
    uint256 discountBps;
    uint256 createdAt;
    uint256 unlockTime;
    uint256 priceUsdPerToken;
    uint256 maxPriceDeviation;
    uint256 ethUsdPrice;
    PaymentCurrency currency;
    bool approved;
    bool paid;
    bool fulfilled;
    bool cancelled;
    address payer;
    uint256 amountPaid;
    uint16 agentCommissionBps; // p2pCommissionBps for P2P (default 0.25%), 25-150 for negotiated deals
  }

  // Multi-token registry
  mapping(bytes32 => RegisteredToken) public tokens;
  bytes32[] public tokenList;
  
  // Consignments
  mapping(uint256 => Consignment) public consignments;
  uint256 public nextConsignmentId = 1;
  
  // Shared
  IERC20 public immutable usdc;
  uint8 public immutable usdcDecimals;
  AggregatorV3Interface public ethUsdFeed;
  
  // Limits and controls
  uint256 public minUsdAmount = 5 * 1e8; // $5 with 8 decimals
  uint256 public maxTokenPerOrder = 10_000 * 1e18; // 10,000 tokens
  uint256 public quoteExpirySeconds = 30 minutes;
  uint256 public defaultUnlockDelaySeconds; // can be set by admin
  uint256 public maxFeedAgeSeconds = 1 hours; // max allowed staleness for price feeds
  uint256 public maxLockupSeconds = 365 days; // max 1 year lockup
  uint256 public constant MAX_OPEN_OFFERS_TO_RETURN = 100; // limit for getOpenOfferIds()

  // P2P commission (for non-negotiable fixed-price deals)
  uint16 public p2pCommissionBps = 25; // Default: 0.25% commission for P2P deals

  // Optional restriction: if true, only beneficiary/agent/approver may fulfill
  bool public restrictFulfillToBeneficiaryOrApprover;
  // If true, only the agent or an approver may fulfill. Takes precedence over restrictFulfillToBeneficiaryOrApprover.
  bool public requireApproverToFulfill;

  // Treasury tracking (per-token)
  mapping(bytes32 => uint256) public tokenDeposited;
  mapping(bytes32 => uint256) public tokenReserved;

  // Gas prepayment tracking (per consignment)
  mapping(uint256 => uint256) public consignmentGasDeposit;
  uint256 public requiredGasDepositPerConsignment = 0.001 ether; // Default: 0.001 ETH per consignment

  // Roles
  address public agent;
  mapping(address => bool) public isApprover; // distributors/approvers
  mapping(address => bool) public authorizedRegistrar; // can register tokens (e.g. RegistrationHelper)
  uint256 public requiredApprovals = 1; // Number of approvals needed (for multi-sig)
  mapping(uint256 => mapping(address => bool)) public offerApprovals; // offerId => approver => approved
  mapping(uint256 => uint256) public approvalCount; // offerId => count

  // Offers
  uint256 public nextOfferId = 1;
  mapping(uint256 => Offer) public offers; // id => Offer
  uint256[] public openOfferIds;
  mapping(address => uint256[]) private _beneficiaryOfferIds;
  
  // Emergency recovery
  bool public emergencyRefundsEnabled;
  uint256 public emergencyRefundDeadline = 30 days; // Time after creation when emergency refund is allowed (reduced from 90d for better UX)

  // Events
  event TokenRegistered(bytes32 indexed tokenId, address indexed tokenAddress, address indexed priceOracle);
  event ConsignmentCreated(uint256 indexed consignmentId, bytes32 indexed tokenId, address indexed consigner, uint256 amount);
  event ConsignmentUpdated(uint256 indexed consignmentId);
  event ConsignmentWithdrawn(uint256 indexed consignmentId, uint256 amount);
  event GasDepositMade(uint256 indexed consignmentId, uint256 amount);
  event GasDepositRefunded(uint256 indexed consignmentId, address indexed consigner, uint256 amount);
  event GasDepositWithdrawn(address indexed agent, uint256 amount);
  event RequiredGasDepositUpdated(uint256 newAmount);
  event AgentUpdated(address indexed previous, address indexed newAgent);
  event ApproverUpdated(address indexed approver, bool allowed);
  event AuthorizedRegistrarUpdated(address indexed registrar, bool allowed);
  event StableWithdrawn(address indexed to, uint256 usdcAmount, uint256 ethAmount);
  event OfferCreated(uint256 indexed id, address indexed beneficiary, uint256 tokenAmount, uint256 discountBps, PaymentCurrency currency, uint16 agentCommissionBps);
  event OfferApproved(uint256 indexed id, address indexed by);
  event OfferCancelled(uint256 indexed id, address indexed by);
  event OfferPaid(uint256 indexed id, address indexed payer, uint256 amountPaid);
  event AgentCommissionPaid(uint256 indexed offerId, address indexed agent, uint256 amount, PaymentCurrency currency);
  event TokensClaimed(uint256 indexed id, address indexed beneficiary, uint256 amount);
  event FeedsUpdated(address indexed tokenUsdFeed, address indexed ethUsdFeed);
  event LimitsUpdated(uint256 minUsdAmount, uint256 maxTokenPerOrder, uint256 quoteExpirySeconds, uint256 defaultUnlockDelaySeconds);
  event MaxFeedAgeUpdated(uint256 maxFeedAgeSeconds);
  event RestrictFulfillUpdated(bool enabled);
  event RequireApproverFulfillUpdated(bool enabled);
  event EmergencyRefundEnabled(bool enabled);
  event EmergencyRefund(uint256 indexed offerId, address indexed recipient, uint256 amount, PaymentCurrency currency);
  event StorageCleaned(uint256 offersRemoved);
  event RefundAttemptFailed(address indexed payer, uint256 amount);
  event P2PCommissionUpdated(uint16 oldBps, uint16 newBps);

  modifier onlyApproverRole() {
    if (msg.sender != agent && !isApprover[msg.sender]) revert NotApprover();
    _;
  }

  constructor(
    address owner_,
    IERC20 usdc_,
    AggregatorV3Interface ethUsdFeed_,
    address agent_
  ) payable Ownable(owner_) {
    if (address(usdc_) == address(0)) revert ZeroAddress();
    if (agent_ == address(0)) revert ZeroAgent();
    usdc = usdc_;
    uint8 decimals_ = IERC20Metadata(address(usdc_)).decimals();
    if (decimals_ != 6 && decimals_ != 18) revert InvalidUsdcDecimals();
    usdcDecimals = decimals_;
    ethUsdFeed = ethUsdFeed_;
    agent = agent_;
    if (ethUsdFeed.decimals() != 8) revert InvalidEthFeedDecimals();
  }

  // Admin
  function setAgent(address newAgent) external onlyOwner { 
    if (newAgent == address(0)) revert ZeroAgent();
    emit AgentUpdated(agent, newAgent); 
    agent = newAgent; 
  }
  function setApprover(address a, bool allowed) external onlyOwner { isApprover[a] = allowed; emit ApproverUpdated(a, allowed); }
  function setAuthorizedRegistrar(address registrar, bool allowed) external onlyOwner { 
    authorizedRegistrar[registrar] = allowed; 
    emit AuthorizedRegistrarUpdated(registrar, allowed); 
  }
  function setRequiredApprovals(uint256 required) external onlyOwner {
    if (required == 0 || required > 10) revert InvalidRequiredApprovals();
    requiredApprovals = required;
  }
  function setEthFeed(AggregatorV3Interface ethUsd) external onlyOwner {
    if (ethUsd.decimals() != 8) revert InvalidEthFeedDecimals();
    ethUsdFeed = ethUsd;
    emit FeedsUpdated(address(0), address(ethUsd));
  }
  function setMaxFeedAge(uint256 secs) external onlyOwner { maxFeedAgeSeconds = secs; emit MaxFeedAgeUpdated(secs); }
  function setLimits(uint256 minUsd, uint256 maxToken, uint256 expirySecs, uint256 unlockDelaySecs) external onlyOwner {
    if (unlockDelaySecs > maxLockupSeconds) revert LockupTooLong();
    minUsdAmount = minUsd; maxTokenPerOrder = maxToken; quoteExpirySeconds = expirySecs; defaultUnlockDelaySeconds = unlockDelaySecs;
    emit LimitsUpdated(minUsdAmount, maxTokenPerOrder, quoteExpirySeconds, defaultUnlockDelaySeconds);
  }
  function setMaxLockup(uint256 maxSecs) external onlyOwner { 
    maxLockupSeconds = maxSecs; 
  }
  function setRequiredGasDeposit(uint256 amount) external onlyOwner {
    if (amount > 0.1 ether) revert GasDepositTooHigh();
    requiredGasDepositPerConsignment = amount;
    emit RequiredGasDepositUpdated(amount);
  }
  function setRestrictFulfill(bool enabled) external onlyOwner { restrictFulfillToBeneficiaryOrApprover = enabled; emit RestrictFulfillUpdated(enabled); }
  function setRequireApproverToFulfill(bool enabled) external onlyOwner { requireApproverToFulfill = enabled; emit RequireApproverFulfillUpdated(enabled); }
  function setEmergencyRefund(bool enabled) external onlyOwner { emergencyRefundsEnabled = enabled; emit EmergencyRefundEnabled(enabled); }
  function setEmergencyRefundDeadline(uint256 days_) external onlyOwner { emergencyRefundDeadline = days_ * 1 days; }
  function setP2PCommission(uint16 bps) external onlyOwner { 
    if (bps > 500) revert CommissionOutOfRange(); // Max 5% for P2P
    uint16 oldBps = p2pCommissionBps;
    p2pCommissionBps = bps;
    emit P2PCommissionUpdated(oldBps, bps);
  }

  function pause() external onlyOwner { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

  // Multi-token management
  function registerToken(bytes32 tokenId, address tokenAddress, address priceOracle) external {
    if (msg.sender != owner() && !authorizedRegistrar[msg.sender]) revert NotAuthorized();
    if (tokens[tokenId].tokenAddress != address(0)) revert TokenExists();
    if (tokenAddress == address(0)) revert ZeroAddress();
    uint8 decimals = IERC20Metadata(tokenAddress).decimals();
    if (decimals > 18) revert InvalidDecimals();
    tokens[tokenId] = RegisteredToken({
      tokenAddress: tokenAddress,
      decimals: decimals,
      isActive: true,
      priceOracle: priceOracle
    });
    tokenList.push(tokenId);
    emit TokenRegistered(tokenId, tokenAddress, priceOracle);
  }

  function createConsignment(
    bytes32 tokenId,
    uint256 amount,
    bool isNegotiable,
    uint16 fixedDiscountBps,
    uint32 fixedLockupDays,
    uint16 minDiscountBps,
    uint16 maxDiscountBps,
    uint32 minLockupDays,
    uint32 maxLockupDays,
    uint256 minDealAmount,
    uint256 maxDealAmount,
    uint16 maxPriceVolatilityBps
  ) external payable nonReentrant whenNotPaused returns (uint256) {
    RegisteredToken memory tkn = tokens[tokenId];
    if (!tkn.isActive) revert TokenNotActive();
    if (amount == 0) revert ZeroAmount();
    if (minDealAmount > maxDealAmount) revert InvalidDealAmounts();
    if (minDiscountBps > maxDiscountBps) revert InvalidDiscountRange();
    if (minLockupDays > maxLockupDays) revert InvalidLockupRange();
    if (msg.value < requiredGasDepositPerConsignment) revert InsufficientGasDeposit();

    uint256 balanceBefore = IERC20(tkn.tokenAddress).balanceOf(address(this));
    IERC20(tkn.tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
    uint256 balanceAfter = IERC20(tkn.tokenAddress).balanceOf(address(this));
    uint256 actualAmount = balanceAfter - balanceBefore;
    if (actualAmount == 0) revert ZeroAmountReceived();
    
    // Update tracked deposit with actual amount received
    tokenDeposited[tokenId] += actualAmount;

    uint256 consignmentId;
    unchecked { consignmentId = nextConsignmentId++; }
    consignments[consignmentId] = Consignment({
      tokenId: tokenId,
      consigner: msg.sender,
      totalAmount: actualAmount,
      remainingAmount: actualAmount,
      isNegotiable: isNegotiable,
      fixedDiscountBps: fixedDiscountBps,
      fixedLockupDays: fixedLockupDays,
      minDiscountBps: minDiscountBps,
      maxDiscountBps: maxDiscountBps,
      minLockupDays: minLockupDays,
      maxLockupDays: maxLockupDays,
      minDealAmount: minDealAmount,
      maxDealAmount: maxDealAmount,
      maxPriceVolatilityBps: maxPriceVolatilityBps,
      isActive: true,
      createdAt: block.timestamp
    });

    // Store ONLY the required gas deposit (not excess)
    consignmentGasDeposit[consignmentId] = requiredGasDepositPerConsignment;
    emit GasDepositMade(consignmentId, requiredGasDepositPerConsignment);

    // Refund excess ETH if any
    if (msg.value > requiredGasDepositPerConsignment) {
      uint256 refund = msg.value - requiredGasDepositPerConsignment;
      (bool success, ) = payable(msg.sender).call{value: refund}("");
      if (!success) revert RefundFailed();
    }

    emit ConsignmentCreated(consignmentId, tokenId, msg.sender, actualAmount);
    return consignmentId;
  }

  function withdrawConsignment(uint256 consignmentId) external nonReentrant {
    Consignment storage c = consignments[consignmentId];
    if (c.consigner != msg.sender) revert NotConsigner();
    if (!c.isActive) revert NotActive();
    uint256 withdrawAmount = c.remainingAmount;
    if (withdrawAmount == 0) revert NothingToWithdraw();

    // CEI: Cache all values first
    bytes32 tokenId_ = c.tokenId;
    uint256 gasDeposit = consignmentGasDeposit[consignmentId];
    
    RegisteredToken memory tkn = tokens[tokenId_];
    if (tkn.tokenAddress == address(0)) revert InvalidToken();
    if (tokenDeposited[tokenId_] < withdrawAmount) revert InsufficientDepositedBalance();

    // CEI: Update ALL state before ANY external calls
    c.isActive = false;
    c.remainingAmount = 0;
    tokenDeposited[tokenId_] -= withdrawAmount;
    consignmentGasDeposit[consignmentId] = 0; // Zero out before external calls
    
    // External call 1: Token transfer
    IERC20(tkn.tokenAddress).safeTransfer(msg.sender, withdrawAmount);

    // External call 2: ETH refund (if any)
    if (gasDeposit > 0) {
      (bool success, ) = payable(msg.sender).call{value: gasDeposit}("");
      if (!success) revert GasRefundFailed();
      emit GasDepositRefunded(consignmentId, msg.sender, gasDeposit);
    }

    emit ConsignmentWithdrawn(consignmentId, withdrawAmount);
  }

  // Treasury management
  function withdrawStable(address to, uint256 usdcAmount, uint256 ethAmount) external onlyOwner nonReentrant {
    if (to == address(0)) revert ZeroAddress();
    if (usdcAmount > 0) { usdc.safeTransfer(to, usdcAmount); }
    if (ethAmount > 0) { (bool ok, ) = payable(to).call{ value: ethAmount }(""); if (!ok) revert EthTransferFailed(); }
    emit StableWithdrawn(to, usdcAmount, ethAmount);
  }

  function withdrawGasDeposits(uint256[] calldata consignmentIds) external onlyApproverRole nonReentrant {
    if (consignmentIds.length > 50) revert BatchTooLarge();
    uint256 totalWithdrawn = 0;
    uint256 len = consignmentIds.length;
    for (uint256 i; i < len;) {
      uint256 id = consignmentIds[i];
      Consignment storage c = consignments[id];
      // Only allow withdrawal if consignment is inactive (withdrawn or depleted)
      if (!c.isActive && consignmentGasDeposit[id] > 0) {
        uint256 amount = consignmentGasDeposit[id];
        consignmentGasDeposit[id] = 0;
        totalWithdrawn += amount;
      }
      unchecked { ++i; }
    }
    if (totalWithdrawn == 0) revert NoGasDepositsToWithdraw();
    (bool success, ) = payable(msg.sender).call{value: totalWithdrawn}("");
    if (!success) revert WithdrawalFailed();
    emit GasDepositWithdrawn(msg.sender, totalWithdrawn);
  }

  function availableTokenInventoryForToken(bytes32 tokenId) public view returns (uint256) {
    RegisteredToken memory tkn = tokens[tokenId];
    if (tkn.tokenAddress == address(0)) revert TokenNotRegistered();
    uint256 bal = IERC20(tkn.tokenAddress).balanceOf(address(this));
    if (bal < tokenReserved[tokenId]) return 0;
    return bal - tokenReserved[tokenId];
  }

  // Multi-token offer creation
  // agentCommissionBps: For negotiated deals: 25-150 bps (0.25% - 1.5%)
  //                     For P2P (non-negotiable): ignored, uses desk-wide p2pCommissionBps (default 0.25%)
  // Commission is calculated as: discount component (25-100 bps) + lockup component (0-50 bps)
  function createOfferFromConsignment(
    uint256 consignmentId,
    uint256 tokenAmount,
    uint256 discountBps,
    PaymentCurrency currency,
    uint256 lockupSeconds,
    uint16 agentCommissionBps
  ) external nonReentrant whenNotPaused returns (uint256) {
    Consignment storage c = consignments[consignmentId];
    if (!c.isActive) revert ConsignmentNotActive();
    if (tokenAmount < c.minDealAmount || tokenAmount > c.maxDealAmount) revert AmountOutOfRange();
    if (tokenAmount > c.remainingAmount) revert InsufficientRemaining();

    // Determine effective commission for the offer
    uint16 effectiveCommissionBps;
    
    if (c.isNegotiable) {
      if (discountBps < c.minDiscountBps || discountBps > c.maxDiscountBps) revert DiscountOutOfRange();
      uint256 lockupDays = lockupSeconds / 1 days;
      if (lockupDays < c.minLockupDays || lockupDays > c.maxLockupDays) revert LockupOutOfRange();
      // Negotiated deals: commission must be 25-150 bps (0.25% - 1.5%)
      if (agentCommissionBps < 25 || agentCommissionBps > 150) revert CommissionOutOfRange();
      effectiveCommissionBps = agentCommissionBps;
    } else {
      if (discountBps != c.fixedDiscountBps) revert MustUseFixedDiscount();
      uint256 lockupDays = lockupSeconds / 1 days;
      if (lockupDays != c.fixedLockupDays) revert MustUseFixedLockup();
      // P2P deals: use the configured p2pCommissionBps (default 0.25%)
      // agentCommissionBps parameter is ignored for P2P - uses desk-wide setting
      effectiveCommissionBps = p2pCommissionBps;
    }

    RegisteredToken memory tkn = tokens[c.tokenId];
    uint256 priceUsdPerToken = _readTokenPrice(c.tokenId);
    
    uint256 tokenDecimalsFactor = 10 ** tkn.decimals;
    uint256 totalUsd = _mulDiv(tokenAmount, priceUsdPerToken, tokenDecimalsFactor);
    totalUsd = (totalUsd * (10_000 - discountBps)) / 10_000;
    if (totalUsd < minUsdAmount) revert MinUsdNotMet();

    c.remainingAmount -= tokenAmount;
    tokenReserved[c.tokenId] += tokenAmount;
    if (c.remainingAmount == 0) c.isActive = false;

    uint256 offerId;
    unchecked { offerId = nextOfferId++; }
    
    // Non-negotiable offers are auto-approved for P2P (permissionless)
    // Negotiable offers require agent/approver approval
    bool autoApproved = !c.isNegotiable;
    
    offers[offerId] = Offer({
      consignmentId: consignmentId,
      tokenId: c.tokenId,
      beneficiary: msg.sender,
      tokenAmount: tokenAmount,
      discountBps: discountBps,
      createdAt: block.timestamp,
      unlockTime: block.timestamp + lockupSeconds,
      priceUsdPerToken: priceUsdPerToken,
      maxPriceDeviation: c.maxPriceVolatilityBps,
      ethUsdPrice: currency == PaymentCurrency.ETH ? _readEthUsdPrice() : 0,
      currency: currency,
      approved: autoApproved,
      paid: false,
      fulfilled: false,
      cancelled: false,
      payer: address(0),
      amountPaid: 0,
      agentCommissionBps: effectiveCommissionBps
    });

    _beneficiaryOfferIds[msg.sender].push(offerId);
    openOfferIds.push(offerId);
    emit OfferCreated(offerId, msg.sender, tokenAmount, discountBps, currency, effectiveCommissionBps);
    
    // Emit approval event for non-negotiable (P2P) offers
    if (autoApproved) {
      emit OfferApproved(offerId, msg.sender);
    }
    
    return offerId;
  }


  function approveOffer(uint256 offerId) external onlyApproverRole whenNotPaused {
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (o.cancelled || o.paid) revert BadState();
    if (o.approved) revert AlreadyApproved();
    
    // Non-negotiable offers are P2P (auto-approved at creation) - cannot be manually approved
    Consignment storage c = consignments[o.consignmentId];
    if (!c.isNegotiable) revert NonNegotiableP2P();
    
    if (offerApprovals[offerId][msg.sender]) revert AlreadyApprovedByYou();
    
    RegisteredToken memory tkn = tokens[o.tokenId];
    if (tkn.tokenAddress == address(0)) revert TokenNotRegistered();
    uint256 currentPrice = _readTokenPrice(o.tokenId);
    
    uint256 priceDiff = currentPrice > o.priceUsdPerToken ? 
      currentPrice - o.priceUsdPerToken : o.priceUsdPerToken - currentPrice;
    uint256 deviationBps = (priceDiff * 10000) / o.priceUsdPerToken;
    if (deviationBps > o.maxPriceDeviation) revert PriceVolatilityExceeded();
    
    offerApprovals[offerId][msg.sender] = true;
    unchecked { approvalCount[offerId]++; }
    
    if (approvalCount[offerId] >= requiredApprovals) {
      o.approved = true;
    }
    
    emit OfferApproved(offerId, msg.sender);
  }

  function cancelOffer(uint256 offerId) external nonReentrant whenNotPaused {
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (o.paid || o.fulfilled) revert AlreadyPaid();
    if (msg.sender != o.beneficiary && msg.sender != owner() && msg.sender != agent && !isApprover[msg.sender]) revert NoAuth();
    // Users can cancel after expiry window
    if (msg.sender == o.beneficiary) {
      if (block.timestamp < o.createdAt + quoteExpirySeconds) revert NotExpired();
    }
    o.cancelled = true;
    tokenReserved[o.tokenId] -= o.tokenAmount;
    
    if (o.consignmentId > 0) {
      Consignment storage c = consignments[o.consignmentId];
      c.remainingAmount += o.tokenAmount;
      if (!c.isActive) {
        c.isActive = true;
      }
    }
    
    emit OfferCancelled(offerId, msg.sender);
  }

  function totalUsdForOffer(uint256 offerId) public view returns (uint256) {
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    
    RegisteredToken memory tkn = tokens[o.tokenId];
    if (tkn.tokenAddress == address(0)) revert TokenNotRegistered();
    uint256 tokenDecimalsFactor = 10 ** tkn.decimals;
    
    uint256 totalUsd = _mulDiv(o.tokenAmount, o.priceUsdPerToken, tokenDecimalsFactor);
    totalUsd = (totalUsd * (10_000 - o.discountBps)) / 10_000;
    return totalUsd;
  }

  function fulfillOffer(uint256 offerId) external payable nonReentrant whenNotPaused {
    Offer storage o = offers[offerId];
    require(o.beneficiary != address(0), "no offer");
    require(o.approved, "not appr");
    require(!o.cancelled && !o.paid && !o.fulfilled, "bad state");
    require(block.timestamp <= o.createdAt + quoteExpirySeconds, "expired");
    
    if (requireApproverToFulfill) {
      require(msg.sender == agent || isApprover[msg.sender], "fulfill approver only");
    } else if (restrictFulfillToBeneficiaryOrApprover) {
      require(msg.sender == o.beneficiary || msg.sender == agent || isApprover[msg.sender], "fulfill restricted");
    }

    RegisteredToken memory tkn = tokens[o.tokenId];
    require(tkn.tokenAddress != address(0), "token not registered");
    uint256 currentPrice = _readTokenPrice(o.tokenId);
    uint256 priceDiff = currentPrice > o.priceUsdPerToken ? 
      currentPrice - o.priceUsdPerToken : o.priceUsdPerToken - currentPrice;
    uint256 deviationBps = (priceDiff * 10000) / o.priceUsdPerToken;
    require(deviationBps <= o.maxPriceDeviation, "price volatility exceeded");

    uint256 usd = totalUsdForOffer(offerId);
    uint256 refundAmount = 0;
    
    // Calculate agent commission (deducted from seller proceeds, not buyer payment)
    uint256 commissionUsd = (usd * o.agentCommissionBps) / 10_000;
    
    if (o.currency == PaymentCurrency.ETH) {
      uint256 ethUsd = o.ethUsdPrice > 0 ? o.ethUsdPrice : _readEthUsdPrice();
      uint256 weiAmount = _mulDivRoundingUp(usd, 1e18, ethUsd);
      require(msg.value >= weiAmount, "insufficient eth");
      
      // Calculate commission upfront
      uint256 commissionWei = 0;
      if (commissionUsd > 0 && agent != address(0)) {
        commissionWei = _mulDiv(commissionUsd, 1e18, ethUsd);
        if (commissionWei > weiAmount) commissionWei = 0; // Safety check
      }
      
      // CEI: Update state BEFORE external calls
      // amountPaid reflects net amount (after commission) for accurate refunds
      o.amountPaid = weiAmount - commissionWei;
      o.payer = msg.sender;
      o.paid = true;
      refundAmount = msg.value - weiAmount;
      
      // Transfer commission to agent
      if (commissionWei > 0) {
        (bool commissionSent, ) = payable(agent).call{value: commissionWei}("");
        if (commissionSent) {
          emit AgentCommissionPaid(offerId, agent, commissionWei, PaymentCurrency.ETH);
        }
      }
    } else {
      uint256 usdcAmount = _mulDivRoundingUp(usd, 10 ** usdcDecimals, 1e8);
      
      // Calculate commission upfront
      uint256 commissionUsdc = 0;
      if (commissionUsd > 0 && agent != address(0)) {
        commissionUsdc = _mulDiv(commissionUsd, 10 ** usdcDecimals, 1e8);
        if (commissionUsdc > usdcAmount) commissionUsdc = 0; // Safety check
      }
      
      // CEI: Update state BEFORE external calls
      // amountPaid reflects net amount (after commission) for accurate refunds
      o.amountPaid = usdcAmount - commissionUsdc;
      o.payer = msg.sender;
      o.paid = true;
      
      // External call after state update
      usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
      
      // Transfer commission to agent
      if (commissionUsdc > 0) {
        usdc.safeTransfer(agent, commissionUsdc);
        emit AgentCommissionPaid(offerId, agent, commissionUsdc, PaymentCurrency.USDC);
      }
    }
    
    // Emit event before potential ETH refund
    emit OfferPaid(offerId, msg.sender, o.amountPaid);
    
    // ETH refund at the very end
    if (refundAmount > 0) {
      (bool refunded, ) = payable(msg.sender).call{ value: refundAmount }("");
      if (!refunded) {
        emit RefundAttemptFailed(msg.sender, refundAmount);
      }
    }
  }

  function claim(uint256 offerId) external nonReentrant whenNotPaused {
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (!o.paid || o.cancelled || o.fulfilled) revert BadState();
    if (block.timestamp < o.unlockTime) revert Locked();
    if (msg.sender != o.beneficiary) revert NotBeneficiary();
    
    // CEI: Cache values and update state before external call
    address beneficiary = o.beneficiary;
    uint256 tokenAmount = o.tokenAmount;
    bytes32 tokenId_ = o.tokenId;
    
    o.fulfilled = true;
    tokenReserved[tokenId_] -= tokenAmount;
    tokenDeposited[tokenId_] -= tokenAmount; // Fix: decrement deposited on claim
    
    RegisteredToken memory tkn = tokens[tokenId_];
    if (tkn.tokenAddress == address(0)) revert TokenNotRegistered();
    IERC20(tkn.tokenAddress).safeTransfer(beneficiary, tokenAmount);
    
    emit TokensClaimed(offerId, beneficiary, tokenAmount);
  }

  /// @notice Batch claim tokens for multiple offers (approver-only)
  /// @dev Uses CEI pattern within each iteration. Reentrancy protection via nonReentrant modifier.
  ///      Slither may report false positive reentrancy due to loop structure, but each iteration
  ///      fully updates state before external call, and offers are marked fulfilled preventing reprocessing.
  // slither-disable-next-line reentrancy-benign,reentrancy-no-eth
  function autoClaim(uint256[] calldata offerIds) external onlyApproverRole nonReentrant whenNotPaused {
    if (offerIds.length > 50) revert BatchTooLarge();
    uint256 len = offerIds.length;
    uint256 nextId = nextOfferId;
    for (uint256 i; i < len;) {
      uint256 id = offerIds[i];
      if (id == 0 || id >= nextId) { unchecked { ++i; } continue; }
      Offer storage o = offers[id];
      if (o.beneficiary == address(0) || !o.paid || o.cancelled || o.fulfilled) { unchecked { ++i; } continue; }
      if (block.timestamp < o.unlockTime) { unchecked { ++i; } continue; }
      
      RegisteredToken memory tkn = tokens[o.tokenId];
      if (tkn.tokenAddress == address(0)) { unchecked { ++i; } continue; } // Skip if token not registered
      
      // CEI Pattern: Cache values, update all state, then make external call
      address beneficiary = o.beneficiary;
      uint256 tokenAmount = o.tokenAmount;
      bytes32 tknId = o.tokenId;
      
      // Effects: Update all state before external call
      o.fulfilled = true;
      tokenReserved[tknId] -= tokenAmount;
      tokenDeposited[tknId] -= tokenAmount;
      
      // Interactions: External call after all state updates
      IERC20(tkn.tokenAddress).safeTransfer(beneficiary, tokenAmount);
      
      emit TokensClaimed(id, beneficiary, tokenAmount);
      unchecked { ++i; }
    }
  }

  function getOpenOfferIds() external view returns (uint256[] memory) {
    uint256 total = openOfferIds.length;
    // Start from the end for more recent offers
    uint256 startIdx = total > MAX_OPEN_OFFERS_TO_RETURN ? total - MAX_OPEN_OFFERS_TO_RETURN : 0;
    uint256 count = 0;
    uint256 expiry = quoteExpirySeconds; // Cache state variable
    
    // First pass: count valid offers
    for (uint256 i = startIdx; i < total && count < MAX_OPEN_OFFERS_TO_RETURN;) {
      Offer storage o = offers[openOfferIds[i]];
      if (!o.cancelled && !o.paid && block.timestamp <= o.createdAt + expiry) { unchecked { ++count; } }
      unchecked { ++i; }
    }
    
    uint256[] memory result = new uint256[](count);
    uint256 idx = 0;
    
    // Second pass: collect valid offers
    for (uint256 j = startIdx; j < total && idx < count;) {
      Offer storage o2 = offers[openOfferIds[j]];
      if (!o2.cancelled && !o2.paid && block.timestamp <= o2.createdAt + expiry) { 
        result[idx] = openOfferIds[j];
        unchecked { ++idx; }
      }
      unchecked { ++j; }
    }
    return result;
  }

  function getOffersForBeneficiary(address who) external view returns (uint256[] memory) { return _beneficiaryOfferIds[who]; }

  function _readTokenPrice(bytes32 tokenId) internal view returns (uint256) {
    RegisteredToken memory tkn = tokens[tokenId];
    return _readTokenUsdPriceFromOracle(tkn.priceOracle);
  }

  function _readTokenUsdPriceFromOracle(address oracle) internal view returns (uint256) {
    AggregatorV3Interface feed = AggregatorV3Interface(oracle);
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
    if (answer <= 0) revert BadPrice();
    if (answeredInRound < roundId) revert StaleRound();
    if (updatedAt == 0 || block.timestamp - updatedAt > maxFeedAgeSeconds) revert StalePrice();
    return uint256(answer);
  }
  
  function _readEthUsdPrice() internal view returns (uint256) {
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();
    if (answer <= 0) revert BadPrice();
    if (answeredInRound < roundId) revert StaleRound();
    if (updatedAt == 0 || block.timestamp - updatedAt > maxFeedAgeSeconds) revert StalePrice();
    return uint256(answer);
  }

  function _mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
    return Math.mulDiv(a, b, d);
  }
  function _mulDivRoundingUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
    return Math.mulDiv(a, b, d, Math.Rounding.Ceil);
  }

  // View helpers for off-chain integrations
  
  /// @notice Calculate recommended agent commission based on discount and lockup
  /// @param discountBps The discount in basis points (e.g., 500 = 5%)
  /// @param lockupDays The lockup period in days
  /// @return commissionBps The recommended commission in basis points (25-150)
  /// @dev Discount component: 100 bps at ≤5% discount, 25 bps at ≥30% discount
  /// @dev Lockup component: 0 bps at 0 days, 50 bps at ≥365 days
  function calculateAgentCommission(uint256 discountBps, uint256 lockupDays) public pure returns (uint16) {
    // Discount component: 100 bps (1.0%) at 5% discount, 25 bps (0.25%) at 30% discount
    // Linear interpolation between 500 and 3000 bps discount
    uint256 discountComponent;
    if (discountBps <= 500) {
      discountComponent = 100; // 1.0%
    } else if (discountBps >= 3000) {
      discountComponent = 25; // 0.25%
    } else {
      // Linear interpolation: 100 - (discountBps - 500) * 75 / 2500
      discountComponent = 100 - ((discountBps - 500) * 75) / 2500;
    }
    
    // Lockup component: 0 bps at 0 days, 50 bps (0.5%) at 365+ days
    // Linear interpolation between 0 and 365 days
    uint256 lockupComponent;
    if (lockupDays >= 365) {
      lockupComponent = 50; // 0.5%
    } else {
      lockupComponent = (lockupDays * 50) / 365;
    }
    
    // Total commission: discount + lockup components
    uint256 totalCommission = discountComponent + lockupComponent;
    
    // Ensure within bounds (25-150 bps)
    if (totalCommission < 25) return 25;
    if (totalCommission > 150) return 150;
    return uint16(totalCommission);
  }
  
  function requiredEthWei(uint256 offerId) external view returns (uint256) {
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (o.currency != PaymentCurrency.ETH) revert NotEth();
    uint256 usd = totalUsdForOffer(offerId);
    uint256 ethUsd = o.ethUsdPrice > 0 ? o.ethUsdPrice : _readEthUsdPrice();
    return _mulDivRoundingUp(usd, 1e18, ethUsd);
  }
  function requiredUsdcAmount(uint256 offerId) external view returns (uint256) {
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (o.currency != PaymentCurrency.USDC) revert NotUsdc();
    uint256 usd = totalUsdForOffer(offerId);
    return _mulDivRoundingUp(usd, 10 ** usdcDecimals, 1e8);
  }

  // Emergency functions
  function emergencyRefund(uint256 offerId) external nonReentrant {
    if (!emergencyRefundsEnabled) revert EmergencyRefundsDisabled();
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (!o.paid || o.fulfilled || o.cancelled) revert InvalidStateForRefund();
    if (msg.sender != o.payer && 
        msg.sender != o.beneficiary && 
        msg.sender != owner() && 
        msg.sender != agent && 
        !isApprover[msg.sender]) revert NotAuthorizedForRefund();
    
    // Check if enough time has passed for emergency refund
    if (block.timestamp < o.createdAt + emergencyRefundDeadline &&
        block.timestamp < o.unlockTime + 30 days) revert TooEarlyForEmergencyRefund();
    
    // CEI: Cache values before state changes
    uint256 consignmentId = o.consignmentId;
    bytes32 tokenId_ = o.tokenId;
    uint256 tokenAmount = o.tokenAmount;
    address payer = o.payer;
    uint256 amountPaid = o.amountPaid;
    PaymentCurrency currency = o.currency;
    
    // Mark as cancelled to prevent double refund
    o.cancelled = true;
    
    // Release reserved tokens
    tokenReserved[tokenId_] -= tokenAmount;
    
    // Return tokens to consignment (if it exists)
    if (consignmentId > 0) {
      Consignment storage c = consignments[consignmentId];
      c.remainingAmount += tokenAmount;
      if (!c.isActive) {
        c.isActive = true;
      }
    }
    
    // Refund payment (external calls at the end)
    if (currency == PaymentCurrency.ETH) {
      (bool success, ) = payable(payer).call{value: amountPaid}("");
      if (!success) revert EthRefundFailed();
    } else {
      usdc.safeTransfer(payer, amountPaid);
    }
    
    emit EmergencyRefund(offerId, payer, amountPaid, currency);
  }
  
  function adminEmergencyWithdraw(uint256 offerId) external onlyOwner nonReentrant {
    // Only for truly stuck funds after all parties have been given chance to claim
    Offer storage o = offers[offerId];
    if (o.beneficiary == address(0)) revert NoOffer();
    if (!o.paid || o.fulfilled || o.cancelled) revert BadState();
    if (block.timestamp < o.unlockTime + 180 days) revert MustWait180Days();
    
    // CEI: Cache values before state changes
    address recipient = o.beneficiary;
    if (recipient == address(0)) recipient = owner(); // Fallback to owner
    uint256 tokenAmount = o.tokenAmount;
    bytes32 tokenId_ = o.tokenId;
    
    // Mark as fulfilled to prevent double withdrawal
    o.fulfilled = true;
    
    // Release reserved tokens and update accounting
    tokenReserved[tokenId_] -= tokenAmount;
    tokenDeposited[tokenId_] -= tokenAmount;
    
    RegisteredToken memory tkn = tokens[tokenId_];
    IERC20(tkn.tokenAddress).safeTransfer(recipient, tokenAmount);
    emit TokensClaimed(offerId, recipient, tokenAmount);
  }
  
  function _cleanupOldOffers() private {
    uint256 currentTime = block.timestamp;
    uint256 removed = 0;
    uint256 newLength = 0;
    uint256 len = openOfferIds.length;
    uint256 expiry = quoteExpirySeconds; // Cache state variable
    
    // Create new array without old expired/completed offers
    for (uint256 i; i < len && removed < 100;) {
      uint256 id = openOfferIds[i];
      Offer storage o = offers[id];
      
      // Keep if still active and not expired
      bool shouldKeep = o.beneficiary != address(0) && 
                       !o.cancelled && 
                       !o.paid && 
                       currentTime <= o.createdAt + expiry + 1 days;
      
      if (shouldKeep) {
        if (newLength != i) {
          openOfferIds[newLength] = id;
        }
        unchecked { ++newLength; }
      } else {
        unchecked { ++removed; }
      }
      unchecked { ++i; }
    }
    
    // Resize array
    while (openOfferIds.length > newLength) {
      openOfferIds.pop();
    }
    
    if (removed > 0) {
      emit StorageCleaned(removed);
    }
  }
  
  function cleanupExpiredOffers(uint256 maxToClean) external whenNotPaused {
    // Public function to allow anyone to help clean storage
    if (maxToClean == 0 || maxToClean > 100) revert InvalidMax();
    uint256 currentTime = block.timestamp;
    uint256 cleaned = 0;
    uint256 len = openOfferIds.length;
    uint256 expiry = quoteExpirySeconds; // Cache state variable
    
    for (uint256 i; i < len && cleaned < maxToClean;) {
      uint256 id = openOfferIds[i];
      Offer storage o = offers[id];
      
      if (o.beneficiary != address(0) && 
          !o.paid && 
          !o.cancelled &&
          currentTime > o.createdAt + expiry + 1 days) {
        // Mark as cancelled to clean up
        o.cancelled = true;
        tokenReserved[o.tokenId] -= o.tokenAmount;
        
        if (o.consignmentId > 0) {
          Consignment storage c = consignments[o.consignmentId];
          c.remainingAmount += o.tokenAmount;
          if (!c.isActive) {
            c.isActive = true;
          }
        }
        
        unchecked { ++cleaned; }
      }
      unchecked { ++i; }
    }
    
    if (cleaned > 0) {
      _cleanupOldOffers();
    }
  }

  receive() external payable {}
}
