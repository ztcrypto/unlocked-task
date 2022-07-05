import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { TestNFT, NFTStaking, RewardToken } from "../src/types";
import { blockNumber, advanceBlocks } from "./utils";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { utils } from "ethers";

chai.use(solidity);

describe("Unit tests", function () {
  let signers: SignerWithAddress[];
  let admin: SignerWithAddress, alice: SignerWithAddress, bob: SignerWithAddress;
  before(async function () {
    signers = await ethers.getSigners();
    admin = signers[0];
    alice = signers[1];
    bob = signers[2];
  });

  let nft1: TestNFT;
  let nft2: TestNFT;
  let staking: NFTStaking;
  let rewardToken: RewardToken;
  let startBlock: number, endBlock: number;
  let rewardPerBlock: number = 100;
  const tokenId = 0;

  describe("NFT Staking", function () {
    beforeEach(async function () {
      const tokenFactory = await ethers.getContractFactory("TestNFT");
      nft1 = (await tokenFactory.deploy()) as TestNFT;
      nft2 = (await tokenFactory.deploy()) as TestNFT;

      const rewardTokenFact = await ethers.getContractFactory("RewardToken");
      rewardToken = (await rewardTokenFact.deploy()) as RewardToken;
      const blockNum = await blockNumber();

      const stakingFact = await ethers.getContractFactory("NFTStaking");
      startBlock = blockNum + 50;
      endBlock = blockNum + 60;
      staking = (await stakingFact.deploy(rewardToken.address, startBlock, endBlock, rewardPerBlock)) as NFTStaking;
      await rewardToken.mint(admin.address, utils.parseEther("1"));
      await rewardToken.transfer(staking.address, utils.parseEther("1"));
    });

    it("Test Token Deployment", async () => {
      expect(await nft1.name()).to.equal("Test NFT");
      expect(await nft2.symbol()).to.equal("TFT");
      expect(await rewardToken.symbol()).to.equal("RWT");
    });

    it("Test updateStartBlock()", async () => {
      await expect(staking.updateStartBlock(endBlock + 10)).to.be.revertedWith("Start block must be before end block");
      await expect(staking.updateStartBlock(startBlock - 50)).to.be.revertedWith(
        "Start block must be after current block",
      );
      const blockNum = (await blockNumber()) + 5;
      await staking.updateStartBlock(blockNum);
      expect(await staking._startBlock()).eq(blockNum);
      await advanceBlocks(10);
      await expect(staking.updateStartBlock((await blockNumber()) + 5)).to.be.revertedWith("Staking started already");
    });

    it("Test updateEndBlock()", async () => {
      await expect(staking.updateEndBlock(startBlock - 10)).to.be.revertedWith("End block must be after start block");
      await staking.updateStartBlock((await blockNumber()) + 5);
      await advanceBlocks(20);
      await expect(staking.updateEndBlock((await blockNumber()) - 5)).to.be.revertedWith(
        "End block must be after current block",
      );
      const blockNum = (await blockNumber()) + 20;
      await staking.updateEndBlock(blockNum);
      expect(await staking._endBlock()).eq(blockNum);
    });

    it("Test updateRewardPerBlock()", async () => {
      await expect(staking.updateRewardPerBlock(0)).to.be.revertedWith("Invalid reward per block");
      await staking.updateRewardPerBlock(200);
      expect(await staking._rewardPerBlock()).eq(200);
    });

    it("Test updateRewardTokenAddress()", async () => {
      const newTokenFact = await ethers.getContractFactory("RewardToken");
      const newToken = (await newTokenFact.deploy()) as RewardToken;
      await staking.updateRewardTokenAddress(newToken.address);
      expect(await staking._rewardTokenAddress()).eq(newToken.address);
      await advanceBlocks(50);
      await expect(staking.updateRewardTokenAddress(newToken.address)).to.be.revertedWith("Staking started already");
    });

    it("Test add & remove whitelist()", async () => {
      await staking.addWhitelistToken(nft1.address);
      expect(await staking.whiteListed(nft1.address)).to.eq(true);
      await staking.removeWhitelistToken(nft1.address);
      expect(await staking.whiteListed(nft1.address)).to.eq(false);
    });

    describe("Test Stake", async () => {
      it("Whitelist and approval Test", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        // Whitelist Test expect
        await expect(staking.connect(alice).stake(nft1.address, tokenId)).to.be.revertedWith(
          "Token need to be whitelisted",
        );
        await staking.addWhitelistToken(nft1.address);
        // Approval Test expect
        await expect(staking.connect(alice).stake(nft1.address, tokenId)).to.be.revertedWith(
          "Not approve nft to staker address",
        );
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        expect(await staking.connect(alice).stake(nft1.address, tokenId)).to.emit(staking, "Staked");
      });
      it("Stake Test", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        await nft1.mint(alice.address); // tokenId = 1
        await staking.addWhitelistToken(nft1.address);
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        await staking.connect(alice).stake(nft1.address, tokenId);
        expect(await nft1.tokenOfOwnerByIndex(staking.address, 0)).eq(tokenId);
        expect(await nft1.balanceOf(alice.address)).eq(1); // Balance is now 1 from 2
        expect(await nft1.balanceOf(staking.address)).eq(1);
        await expect(staking.connect(alice).stake(nft1.address, 1)).to.be.revertedWith(
          "This collection is already staked",
        );
      });
      it("Stake multiple NFTs", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        await nft2.mint(alice.address); // tokenId = 0
        await staking.addWhitelistToken(nft1.address);
        await staking.addWhitelistToken(nft2.address);
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        await nft2.connect(alice).setApprovalForAll(staking.address, true);
        await staking.connect(alice).stake(nft1.address, tokenId);
        await staking.connect(alice).stake(nft2.address, tokenId);
        expect(await nft1.balanceOf(alice.address)).eq(0); // Balance is now 0 from 1
        expect(await nft1.balanceOf(staking.address)).eq(1);
        expect(await nft2.balanceOf(staking.address)).eq(1);
      });
    });

    describe("Test Withdraw", async () => {
      it("Withdraw emits event", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        await staking.addWhitelistToken(nft1.address);
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        await staking.connect(alice).stake(nft1.address, 0);
        await expect(staking.connect(alice).withdraw(nft1.address, 1)).to.be.revertedWith("Not staked this nft");
        expect(await staking.connect(alice).withdraw(nft1.address, tokenId)).to.emit(staking, "Withdrawn");
        expect(await nft1.balanceOf(alice.address)).eq(1); // Balance is now 1 from 0
        expect(await nft1.balanceOf(staking.address)).eq(0);
      });
      it("Withdraw amount test", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        await staking.addWhitelistToken(nft1.address);
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        await staking.connect(alice).stake(nft1.address, tokenId);
        await advanceBlocks(50);
        const blockCount = (await blockNumber()) - startBlock + 1;
        await staking.connect(alice).withdraw(nft1.address, tokenId);
        expect(await rewardToken.balanceOf(alice.address)).to.eq(blockCount * rewardPerBlock);
      });
      it("Multiple reward for multiple NFT stake", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        await nft2.mint(alice.address); // tokenId = 0
        await staking.addWhitelistToken(nft1.address);
        await staking.addWhitelistToken(nft2.address);
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        await nft2.connect(alice).setApprovalForAll(staking.address, true);
        await staking.connect(alice).stake(nft1.address, tokenId);
        await staking.connect(alice).stake(nft2.address, tokenId);
        await advanceBlocks(45);
        const blockCount = (await blockNumber()) - startBlock + 1;
        await staking.connect(alice).withdraw(nft1.address, tokenId);
        expect(await rewardToken.balanceOf(alice.address)).to.eq(blockCount * rewardPerBlock * 2);
      });
      it("InsufficientReward test", async () => {
        await nft1.mint(alice.address); // tokenId = 0
        await staking.addWhitelistToken(nft1.address);
        await nft1.connect(alice).setApprovalForAll(staking.address, true);
        await staking.connect(alice).stake(nft1.address, tokenId);
        await staking.rescueERC20(rewardToken.address, bob.address, utils.parseEther("1"));
        await rewardToken.connect(bob).transfer(staking.address, 200);
        await advanceBlocks(50);
        const blockCount = (await blockNumber()) - startBlock + 1;
        expect(await staking.connect(alice).withdraw(nft1.address, tokenId)).to.emit(
          staking,
          "InsufficientRewardToken",
        );
        expect(await rewardToken.balanceOf(alice.address)).to.eq(200);
      });
    });

    it("Test pendingRewards()", async () => {
      await nft1.mint(alice.address); // tokenId = 0
      await staking.addWhitelistToken(nft1.address);
      await nft1.connect(alice).setApprovalForAll(staking.address, true);
      await staking.connect(alice).stake(nft1.address, 0);
      await advanceBlocks(50);
      const blockCount = (await blockNumber()) - startBlock;
      expect(await staking.pendingRewards(alice.address)).to.eq(blockCount * rewardPerBlock);
    });

    it("Test viewUserInfo()", async () => {
      await nft1.mint(alice.address); // tokenId = 0
      await nft2.mint(alice.address); // tokenId = 0
      await staking.addWhitelistToken(nft1.address);
      await staking.addWhitelistToken(nft2.address);
      await nft1.connect(alice).setApprovalForAll(staking.address, true);
      await nft2.connect(alice).setApprovalForAll(staking.address, true);
      let userInfo = await staking.viewUserInfo(alice.address);
      expect(userInfo.stakedNfts.length).eq(0);
      expect(userInfo.tokenIds.length).eq(0);

      await staking.connect(alice).stake(nft1.address, tokenId);
      await staking.connect(alice).stake(nft2.address, tokenId);

      userInfo = await staking.viewUserInfo(alice.address);
      expect(userInfo.stakedNfts.length).eq(2);
      expect(userInfo.tokenIds.length).eq(2);
      expect(userInfo.stakedNfts[0]).eq(nft1.address);
      expect(userInfo.stakedNfts[1]).eq(nft2.address);
      expect(userInfo.tokenIds[0]).eq(tokenId);
      expect(userInfo.tokenIds[1]).eq(tokenId);
    });

    it("liquidate Test", async () => {
      await nft1.mint(alice.address); // tokenId = 0
      await staking.addWhitelistToken(nft1.address);
      await nft1.connect(alice).setApprovalForAll(staking.address, true);
      await staking.connect(alice).stake(nft1.address, tokenId);
      await expect(staking.liquidate(alice.address, nft1.address, tokenId, bob.address)).to.be.revertedWith(
        "Staking is not started",
      );
      await advanceBlocks(100);

      await expect(staking.liquidate(alice.address, nft1.address, 1, bob.address)).to.be.revertedWith(
        "Not staked this nft",
      );
      await expect(staking.liquidate(alice.address, nft1.address, tokenId, bob.address)).to.be.revertedWith(
        "Exceed liquidation price",
      );
      await staking.setTokenPrice(utils.parseEther("0.4"));
      expect(await staking.liquidate(alice.address, nft1.address, tokenId, bob.address)).to.emit(staking, "Liquidated");
      expect(await nft1.tokenOfOwnerByIndex(bob.address, 0)).eq(tokenId);
      expect(await nft1.balanceOf(staking.address)).eq(0);
    });
  });
});
