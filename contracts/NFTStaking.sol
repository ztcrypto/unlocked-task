// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;
/*
Allow any user to stake different collections of NFTs, restricted 1 token per NFT.
Will be rewarded by block and staked NFT count.
*/
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract NFTStaking is Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    /** Reward Token address */
    address public _rewardTokenAddress;
    /** Reward per block */
    uint256 public _rewardPerBlock = 1 ether;
    /** Staking start & end block */
    uint256 public _startBlock;
    uint256 public _endBlock;
    uint256 private tokenValue = 1 ether;

    mapping(address => bool) public whiteListed;

    struct TokenInfo {
        uint256 tokenId;
        uint256 tokenPrice;
    }

    struct UserInfo {
        EnumerableSet.AddressSet stakedNfts;
        uint256 rewards;
        uint256 lastRewardBlock;
        mapping(address => TokenInfo) tokenInfo;
    }

    // Info of each user that stakes LP tokens.
    mapping(address => UserInfo) private _userInfo;

    event RewardTokenUpdated(address oldToken, address newToken);
    event RewardPerBlockUpdated(uint256 oldValue, uint256 newValue);
    event Staked(address indexed account, address indexed token, uint256 tokenId);
    event Withdrawn(address indexed account, address indexed token, uint256 tokenId);
    event Harvested(address indexed account, uint256 amount);
    event InsufficientRewardToken(address indexed account, uint256 amountNeeded, uint256 balance);
    event Liquidated(address indexed account, address indexed token, uint256 tokenId, address liquidatorAdd);

    modifier isWhitelisted(address _address) {
        require(whiteListed[_address], "Token need to be whitelisted");
        _;
    }

    constructor(
        address __rewardTokenAddress,
        uint256 __startBlock,
        uint256 __endBlock,
        uint256 __rewardPerBlock
    ) {
        IERC20(__rewardTokenAddress).balanceOf(address(this));
        require(__rewardPerBlock > 0, "Invalid reward per block");
        require(__startBlock <= __endBlock, "Start block must be before end block");
        require(__startBlock > block.number, "Start block must be after current block");

        _rewardTokenAddress = __rewardTokenAddress;
        _rewardPerBlock = __rewardPerBlock;
        _startBlock = __startBlock;
        _endBlock = __endBlock;
    }

    function viewUserInfo(address __account)
        external
        view
        returns (
            address[] memory stakedNfts,
            uint256[] memory tokenIds,
            uint256 rewards,
            uint256 lastRewardBlock
        )
    {
        UserInfo storage user = _userInfo[__account];
        rewards = user.rewards;
        lastRewardBlock = user.lastRewardBlock;
        uint256 countNfts = user.stakedNfts.length();
        if (countNfts == 0) {
            // Return an empty array
            stakedNfts = new address[](0);
            tokenIds = new uint256[](0);
        } else {
            stakedNfts = new address[](countNfts);
            tokenIds = new uint256[](countNfts);
            uint256 index;
            for (index = 0; index < countNfts; index++) {
                stakedNfts[index] = tokenOfOwnerByIndex(__account, index);
                tokenIds[index] = user.tokenInfo[stakedNfts[index]].tokenId;
            }
        }
    }

    function tokenOfOwnerByIndex(address __account, uint256 __index) public view returns (address) {
        UserInfo storage user = _userInfo[__account];
        return user.stakedNfts.at(__index);
    }

    function userStakedNFTCount(address __account) public view returns (uint256) {
        UserInfo storage user = _userInfo[__account];
        return user.stakedNfts.length();
    }

    function updateRewardTokenAddress(address __rewardTokenAddress) external onlyOwner {
        require(_startBlock > block.number, "Staking started already");
        IERC20(__rewardTokenAddress).balanceOf(address(this));
        emit RewardTokenUpdated(_rewardTokenAddress, __rewardTokenAddress);
        _rewardTokenAddress = __rewardTokenAddress;
    }

    function updateRewardPerBlock(uint256 __rewardPerBlock) external onlyOwner {
        require(__rewardPerBlock > 0, "Invalid reward per block");
        emit RewardPerBlockUpdated(_rewardPerBlock, __rewardPerBlock);
        _rewardPerBlock = __rewardPerBlock;
    }

    function updateStartBlock(uint256 __startBlock) external onlyOwner {
        require(__startBlock <= _endBlock, "Start block must be before end block");
        require(__startBlock > block.number, "Start block must be after current block");
        require(_startBlock > block.number, "Staking started already");
        _startBlock = __startBlock;
    }

    function updateEndBlock(uint256 __endBlock) external onlyOwner {
        require(__endBlock >= _startBlock, "End block must be after start block");
        require(__endBlock > block.number, "End block must be after current block");
        _endBlock = __endBlock;
    }

    function addWhitelistToken(address __whitelistAddress) external onlyOwner {
        whiteListed[__whitelistAddress] = true;
    }

    function removeWhitelistToken(address __whitelistAddress) external onlyOwner {
        whiteListed[__whitelistAddress] = false;
    }

    function isStaked(
        address __account,
        address __nft,
        uint256 __tokenId
    ) public view returns (bool) {
        UserInfo storage user = _userInfo[__account];
        return user.stakedNfts.contains(__nft) && user.tokenInfo[__nft].tokenId == __tokenId;
    }

    function pendingRewards(address __account) public view returns (uint256) {
        UserInfo storage user = _userInfo[__account];
        uint256 fromBlock = user.lastRewardBlock < _startBlock ? _startBlock : user.lastRewardBlock;
        uint256 toBlock = block.number < _endBlock ? block.number : _endBlock;
        if (toBlock < fromBlock) {
            return user.rewards;
        }
        uint256 amount = toBlock.sub(fromBlock).mul(userStakedNFTCount(__account)).mul(_rewardPerBlock);
        return user.rewards.add(amount);
    }

    function setTokenPrice(uint256 __price) external onlyOwner {
        tokenValue = __price;
    }

    function tokenPrice(address __nft, uint256 __tokenId) public view returns (uint256) {
        return tokenValue;
    }

    function stake(address __nft, uint256 __tokenId) external nonReentrant isWhitelisted(__nft) {
        require(IERC721(__nft).isApprovedForAll(_msgSender(), address(this)), "Not approve nft to staker address");
        UserInfo storage user = _userInfo[_msgSender()];
        require(user.stakedNfts.contains(__nft) == false, "This collection is already staked");
        harvest(_msgSender());

        IERC721(__nft).safeTransferFrom(_msgSender(), address(this), __tokenId);
        user.stakedNfts.add(__nft);
        user.tokenInfo[__nft].tokenId = __tokenId;
        user.tokenInfo[__nft].tokenPrice = tokenPrice(__nft, __tokenId);
        emit Staked(_msgSender(), __nft, __tokenId);
    }

    function withdraw(address __nft, uint256 __tokenId) external nonReentrant {
        UserInfo storage user = _userInfo[_msgSender()];
        harvest(_msgSender());
        require(isStaked(_msgSender(), __nft, __tokenId), "Not staked this nft");

        IERC721(__nft).safeTransferFrom(address(this), _msgSender(), __tokenId);
        user.stakedNfts.remove(__nft);
        delete user.tokenInfo[__nft];
        emit Withdrawn(_msgSender(), __nft, __tokenId);
    }

    function liquidate(
        address __account,
        address __nft,
        uint256 __tokenId,
        address __liquidatorAdd
    ) external nonReentrant onlyOwner {
        UserInfo storage user = _userInfo[__account];
        harvest(__account);
        require(_startBlock <= block.number, "Staking is not started");
        require(isStaked(__account, __nft, __tokenId), "Not staked this nft");
        require(user.tokenInfo[__nft].tokenPrice / 2 > tokenPrice(__nft, __tokenId), "Exceed liquidation price");

        IERC721(__nft).safeTransferFrom(address(this), __liquidatorAdd, __tokenId);
        user.stakedNfts.remove(__nft);
        delete user.tokenInfo[__nft];
        emit Liquidated(__account, __nft, __tokenId, __liquidatorAdd);
    }

    function harvest(address __account) internal {
        UserInfo storage user = _userInfo[__account];
        uint256 pendingAmount = pendingRewards(__account);
        if (pendingAmount > 0) {
            uint256 amountSent = safeRewardTransfer(__account, pendingAmount);
            user.rewards = pendingAmount.sub(amountSent);
            emit Harvested(__account, amountSent);
        }
        user.lastRewardBlock = block.number;
    }

    function safeRewardTransfer(address __to, uint256 __amount) internal returns (uint256) {
        uint256 balance = IERC20(_rewardTokenAddress).balanceOf(address(this));
        if (balance >= __amount) {
            IERC20(_rewardTokenAddress).safeTransfer(__to, __amount);
            return __amount;
        }

        if (balance > 0) {
            IERC20(_rewardTokenAddress).safeTransfer(__to, balance);
        }
        emit InsufficientRewardToken(__to, __amount, balance);
        return balance;
    }

    function rescueERC20(
        IERC20 token,
        address to,
        uint256 amount
    ) external onlyOwner {
        token.safeTransfer(to, amount);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
