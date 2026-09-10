/*
Navicat MySQL Data Transfer


Target Server Type    : MYSQL
Target Server Version : 80045
File Encoding         : 65001

Date: 2026-05-31 19:58:52
*/

SET FOREIGN_KEY_CHECKS=0;

-- ----------------------------
-- Table structure for cchangwat
-- ----------------------------
DROP TABLE IF EXISTS `cchangwat`;
CREATE TABLE `cchangwat` (
  `changwatcode` varchar(2) NOT NULL,
  `changwatname` varchar(255) DEFAULT NULL,
  `zonecode` varchar(2) DEFAULT NULL,
  `changwatname_en` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`changwatcode`) USING BTREE,
  KEY `changwatcode` (`changwatcode`) USING BTREE,
  KEY `changwatname` (`changwatname`) USING BTREE,
  KEY `changwatname_en` (`changwatname_en`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

-- ----------------------------
-- Records of cchangwat
-- ----------------------------
INSERT INTO `cchangwat` VALUES ('10', 'กรุงเทพมหานคร', '13', 'Bangkok');
INSERT INTO `cchangwat` VALUES ('11', 'สมุทรปราการ', '06', 'Samut Prakan');
INSERT INTO `cchangwat` VALUES ('12', 'นนทบุรี', '04', 'Nonthaburi');
INSERT INTO `cchangwat` VALUES ('13', 'ปทุมธานี', '04', 'Pathum Thani');
INSERT INTO `cchangwat` VALUES ('14', 'พระนครศรีอยุธยา', '04', 'Phra Nakhon Si Ayutthaya');
INSERT INTO `cchangwat` VALUES ('15', 'อ่างทอง', '04', 'Ang Thong');
INSERT INTO `cchangwat` VALUES ('16', 'ลพบุรี', '04', 'Lopburi');
INSERT INTO `cchangwat` VALUES ('17', 'สิงห์บุรี', '04', 'Sing Buri');
INSERT INTO `cchangwat` VALUES ('18', 'ชัยนาท', '03', 'Chai Nat');
INSERT INTO `cchangwat` VALUES ('19', 'สระบุรี', '04', 'Saraburi');
INSERT INTO `cchangwat` VALUES ('20', 'ชลบุรี', '06', 'Chonburi');
INSERT INTO `cchangwat` VALUES ('21', 'ระยอง', '06', 'Rayong');
INSERT INTO `cchangwat` VALUES ('22', 'จันทบุรี', '06', 'Chanthaburi');
INSERT INTO `cchangwat` VALUES ('23', 'ตราด', '06', 'Trat');
INSERT INTO `cchangwat` VALUES ('24', 'ฉะเชิงเทรา', '06', 'Chachoengsao');
INSERT INTO `cchangwat` VALUES ('25', 'ปราจีนบุรี', '06', 'Prachinburi');
INSERT INTO `cchangwat` VALUES ('26', 'นครนายก', '04', 'Nakhon Nayok');
INSERT INTO `cchangwat` VALUES ('27', 'สระแก้ว', '06', 'Sa Kaeo');
INSERT INTO `cchangwat` VALUES ('30', 'นครราชสีมา', '09', 'Nakhon Ratchasima');
INSERT INTO `cchangwat` VALUES ('31', 'บุรีรัมย์', '09', 'Buriram');
INSERT INTO `cchangwat` VALUES ('32', 'สุรินทร์', '09', 'Surin');
INSERT INTO `cchangwat` VALUES ('33', 'ศรีสะเกษ', '10', 'Sisaket');
INSERT INTO `cchangwat` VALUES ('34', 'อุบลราชธานี', '10', 'Ubon Ratchathani');
INSERT INTO `cchangwat` VALUES ('35', 'ยโสธร', '10', 'Yasothon');
INSERT INTO `cchangwat` VALUES ('36', 'ชัยภูมิ', '09', 'Chaiyaphum');
INSERT INTO `cchangwat` VALUES ('37', 'อำนาจเจริญ', '10', 'Amnat Charoen');
INSERT INTO `cchangwat` VALUES ('38', 'บึงกาฬ', '08', 'Bueng Kan');
INSERT INTO `cchangwat` VALUES ('39', 'หนองบัวลำภู', '08', 'Nong Bua Lam Phu');
INSERT INTO `cchangwat` VALUES ('40', 'ขอนแก่น', '07', 'Khon Kaen');
INSERT INTO `cchangwat` VALUES ('41', 'อุดรธานี', '08', 'Udon Thani');
INSERT INTO `cchangwat` VALUES ('42', 'เลย', '08', 'Loei');
INSERT INTO `cchangwat` VALUES ('43', 'หนองคาย', '08', 'Nong Khai');
INSERT INTO `cchangwat` VALUES ('44', 'มหาสารคาม', '07', 'Maha Sarakham');
INSERT INTO `cchangwat` VALUES ('45', 'ร้อยเอ็ด', '07', 'Roi Et');
INSERT INTO `cchangwat` VALUES ('46', 'กาฬสินธุ์', '07', 'Kalasin');
INSERT INTO `cchangwat` VALUES ('47', 'สกลนคร', '08', 'Sakon Nakhon');
INSERT INTO `cchangwat` VALUES ('48', 'นครพนม', '08', 'Nakhon Phanom');
INSERT INTO `cchangwat` VALUES ('49', 'มุกดาหาร', '10', 'Mukdahan');
INSERT INTO `cchangwat` VALUES ('50', 'เชียงใหม่', '01', 'Chiang Mai');
INSERT INTO `cchangwat` VALUES ('51', 'ลำพูน', '01', 'Lamphun');
INSERT INTO `cchangwat` VALUES ('52', 'ลำปาง', '01', 'Lampang');
INSERT INTO `cchangwat` VALUES ('53', 'อุตรดิตถ์', '02', 'Uttaradit');
INSERT INTO `cchangwat` VALUES ('54', 'แพร่', '01', 'Phrae');
INSERT INTO `cchangwat` VALUES ('55', 'น่าน', '01', 'Nan');
INSERT INTO `cchangwat` VALUES ('56', 'พะเยา', '01', 'Phayao');
INSERT INTO `cchangwat` VALUES ('57', 'เชียงราย', '01', 'Chiang Rai');
INSERT INTO `cchangwat` VALUES ('58', 'แม่ฮ่องสอน', '01', 'Mae Hong Son');
INSERT INTO `cchangwat` VALUES ('60', 'นครสวรรค์', '03', 'Nakhon Sawan');
INSERT INTO `cchangwat` VALUES ('61', 'อุทัยธานี', '03', 'Uthai Thani');
INSERT INTO `cchangwat` VALUES ('62', 'กำแพงเพชร', '03', 'Kamphaeng Phet');
INSERT INTO `cchangwat` VALUES ('63', 'ตาก', '02', 'Tak');
INSERT INTO `cchangwat` VALUES ('64', 'สุโขทัย', '02', 'Sukhothai (Sukhothai Thani)');
INSERT INTO `cchangwat` VALUES ('65', 'พิษณุโลก', '02', 'Phitsanulok');
INSERT INTO `cchangwat` VALUES ('66', 'พิจิตร', '03', 'Phichit');
INSERT INTO `cchangwat` VALUES ('67', 'เพชรบูรณ์', '02', 'Phetchabun');
INSERT INTO `cchangwat` VALUES ('70', 'ราชบุรี', '05', 'Ratchaburi');
INSERT INTO `cchangwat` VALUES ('71', 'กาญจนบุรี', '05', 'Kanchanaburi');
INSERT INTO `cchangwat` VALUES ('72', 'สุพรรณบุรี', '05', 'Suphan Buri');
INSERT INTO `cchangwat` VALUES ('73', 'นครปฐม', '05', 'Nakhon Pathom');
INSERT INTO `cchangwat` VALUES ('74', 'สมุทรสาคร', '05', 'Samut Sakhon');
INSERT INTO `cchangwat` VALUES ('75', 'สมุทรสงคราม', '05', 'Samut Songkhram');
INSERT INTO `cchangwat` VALUES ('76', 'เพชรบุรี', '05', 'Phetchaburi');
INSERT INTO `cchangwat` VALUES ('77', 'ประจวบคีรีขันธ์', '05', 'Prachuap Khiri Khan');
INSERT INTO `cchangwat` VALUES ('80', 'นครศรีธรรมราช', '11', 'Nakhon Si Thammarat');
INSERT INTO `cchangwat` VALUES ('81', 'กระบี่', '11', 'Krabi');
INSERT INTO `cchangwat` VALUES ('82', 'พังงา', '11', 'Phang Nga');
INSERT INTO `cchangwat` VALUES ('83', 'ภูเก็ต', '11', 'Phuket');
INSERT INTO `cchangwat` VALUES ('84', 'สุราษฎร์ธานี', '11', 'Surat Thani');
INSERT INTO `cchangwat` VALUES ('85', 'ระนอง', '11', 'Ranong');
INSERT INTO `cchangwat` VALUES ('86', 'ชุมพร', '11', 'Chumphon');
INSERT INTO `cchangwat` VALUES ('90', 'สงขลา', '12', 'Songkhla');
INSERT INTO `cchangwat` VALUES ('91', 'สตูล', '12', 'Satun');
INSERT INTO `cchangwat` VALUES ('92', 'ตรัง', '12', 'Trang');
INSERT INTO `cchangwat` VALUES ('93', 'พัทลุง', '12', 'Phatthalung');
INSERT INTO `cchangwat` VALUES ('94', 'ปัตตานี', '12', 'Pattani');
INSERT INTO `cchangwat` VALUES ('95', 'ยะลา', '12', 'Yala');
INSERT INTO `cchangwat` VALUES ('96', 'นราธิวาส', '12', 'Narathiwat');
INSERT INTO `cchangwat` VALUES ('99', 'ไม่ทราบ', '99', 'Unknown');
